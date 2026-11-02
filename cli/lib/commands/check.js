const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const { reportErrors } = require('./common.js');
const { checkNames, runChecks, selectChecks } = require('../check/index.js');
const {
  applyDuplicates,
  duplicateGroups,
  planDuplicates,
  resolveGroup
} = require('../check/duplicates.js');
const { applyFixes, fixableChecks, planFixes } = require('../check/fix.js');
const { activeRun } = require('../history/journal.js');
const { openLibrary } = require('../db/index.js');
const { listFiles, updateDatabase } = require('../db/update.js');
const { renderDuplicatePlan, renderPlan, renderReport } = require('../output/check.js');
const { pickWithFzf, previewCommand } = require('../output/fzf.js');
const { progressBar } = require('../output/progress.js');
const { confirm: confirmPrompt } = require('../utils/confirm.js');
const logger = require('../utils/logger.js');

const plural = (count, word, words = `${word}s`) => `${count} ${count === 1 ? word : words}`;

// a progress bar for one phase (reading tags, planning repairs, writing), timed from its first call
const phaseProgress = (label, unit) => {
  const startedAt = new Date();
  return (done, total) => logger.progress(progressBar({ done, total, label, unit, startedAt }));
};

/**
 * check --fix: after the report, plans the repairs of the fixable checks found (fixableChecks), shows
 * them, and after confirm writes every file's tag once (recorded for musicman undo by the run), then
 * brings the database up to date (drift). With dryRun, or without a terminal to ask in, nothing changes.
 */
const runTagFix = async ({ db, config, target, results, switches, confirm, quiet = false }) => {
  const scope = path.relative(path.resolve(config.mpd.baseDirectory), path.resolve(target));
  const songs = db
    .prepare('SELECT id, path FROM songs ORDER BY path')
    .all()
    .filter(({ path: song }) => !scope || song === scope || song.startsWith(`${scope}/`));
  const plan = await planFixes({
    db,
    config,
    results,
    songs,
    onProgress: phaseProgress('Planning repairs', 'files')
  });
  logger.progressDone();
  const drift = _.get(_.find(results, { name: 'drift' }), 'findings', []);
  if (plan.files.length === 0 && drift.length === 0) {
    if (!quiet) {
      logger.info('Nothing to repair');
    }
    return { plan, written: [], failed: [] };
  }
  _.each(renderPlan(plan, { all: switches.all }), line => logger.consoleLog(line));
  if (drift.length > 0) {
    logger.consoleLog(`drift       ${plural(drift.length, 'file')} updated in the database`);
  }
  if (switches.dryRun) {
    logger.info('Dry run, nothing changed');
    return { plan, written: [], failed: [], dryRun: true };
  }
  if (!confirm) {
    logger.warn(
      'Not a terminal to ask in, nothing changed (check --fix asks first; --dry-run only shows)'
    );
    return { plan, written: [], failed: [] };
  }
  const total = _.sumBy(plan.files, ({ changes }) => changes.length);
  if (
    !(await confirm(
      `Write ${plural(total, 'change')} to ${plural(plan.files.length, 'file')}${drift.length ? ' and update the database' : ''}?`
    ))
  ) {
    logger.info('Nothing changed');
    return { plan, written: [], failed: [] };
  }
  const { written, failed } = await applyFixes({
    config,
    plan,
    onProgress: phaseProgress('Writing', 'files')
  });
  logger.progressDone();
  _.each(failed, ({ file, error }) => logger.warn(`FAILED  ${file}: ${error}`));
  if (written.length > 0) {
    await updateDatabase(db, { config, files: written, record: false });
  }
  if (drift.length > 0) {
    await updateDatabase(db, { config, target });
  }
  logger.info(
    `Repaired ${plural(written.length, 'file')}${failed.length ? `, ${failed.length} failed` : ''}; musicman undo restores the tags`
  );
  return { plan, written, failed };
};

// the copy to keep of each group no rule decides, picked in fzf one group at a time; a group left
// without a pick (esc) keeps every copy, only its live matches are still cleared
const pickKeeps = (groups, { config, pick }) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const open = _.filter(groups, ({ candidates }) => candidates.length > 0);
  return _.map(groups, group => {
    if (group.candidates.length === 0) {
      return group;
    }
    const [picked] = pick(
      _.map(group.candidates, file => `${path.join(baseDirectory, file)}\t${file}`),
      {
        multi: false,
        prompt: 'keep',
        header: `Duplicates ${open.indexOf(group) + 1}/${open.length}: pick the copy to keep, the others go to the trash (esc keeps them all)`,
        preview: previewCommand('view')
      }
    );
    return picked
      ? resolveGroup(group, path.relative(baseDirectory, picked))
      : { ...group, keep: null, remove: [], candidates: [] };
  });
};

// one fzf line per group: index, what happens, and the plan lines shown in the preview
const groupLine = (group, index) => {
  const text = _.compact([
    group.keep && `keep ${group.keep}`,
    group.remove.length > 0 && `remove ${group.remove.length}`,
    group.clear.length > 0 && `clear ${group.clear.length}`
  ]).join('  ');
  const details = _.compact([
    group.keep && `keep    ${group.keep}`,
    ..._.map(group.remove, file => `remove  ${file}  (${group.reasons[file]})`),
    ..._.map(group.clear, file => `clear   ${file}  (${group.reasons[file]})`)
  ])
    .join('\\n')
    .replace(/\t/g, ' ');
  return `${index}\t${text}\t${details}`;
};

/**
 * check --fix for duplicates: plans each group (planDuplicates), shows the plan, lets the groups no rule
 * decides be picked and the plan be narrowed in fzf (all groups selected), and after confirm applies it:
 * removed copies go to the trash, recorded for musicman undo. Without a terminal, or with dryRun, only
 * the plan is shown.
 */
const runDuplicateFix = async ({ db, config, results, switches, confirm, pick }) => {
  const findings = _.get(_.find(results, { name: 'duplicates' }), 'findings', []);
  const planned = planDuplicates(duplicateGroups(db, findings));
  if (planned.length === 0) {
    return null;
  }
  _.each(renderDuplicatePlan(planned, { all: switches.all }), line => logger.consoleLog(line));
  if (switches.dryRun) {
    return { groups: planned, removed: [], cleared: [], merged: [], failed: [], dryRun: true };
  }
  if (!confirm || !pick) {
    logger.warn('Not a terminal to pick in, no duplicates changed (check --fix asks first)');
    return { groups: planned, removed: [], cleared: [], merged: [], failed: [] };
  }
  const resolved = _.filter(
    pickKeeps(planned, { config, pick }),
    ({ remove, clear }) => remove.length + clear.length > 0
  );
  const chosen = new Set(
    pick(_.map(resolved, groupLine), {
      multi: true,
      prompt: 'apply',
      header: 'Duplicates to repair: enter applies the selected groups, tab toggles one',
      withNth: '2',
      binds: ['start:select-all'],
      preview: "printf '%b' {3}"
    })
  );
  const groups = _.filter(resolved, (group, index) => chosen.has(`${index}`));
  const removed = _.sumBy(groups, ({ remove }) => remove.length);
  const cleared = _.sumBy(groups, ({ clear }) => clear.length);
  if (
    groups.length === 0 ||
    !(await confirm(
      `Move ${plural(removed, 'copy', 'copies')} to the trash${cleared ? ` and clear ${plural(cleared, 'live match', 'live matches')}` : ''}?`
    ))
  ) {
    logger.info('No duplicates changed');
    return { groups, removed: [], cleared: [], merged: [], failed: [] };
  }
  const runId =
    activeRun() ||
    new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, '')
      .replace(/[-:]/g, '');
  const result = await applyDuplicates({
    db,
    config,
    groups,
    runId,
    onProgress: phaseProgress('Removing duplicates', 'groups')
  });
  logger.progressDone();
  _.each(result.failed, ({ file, error }) => logger.warn(`FAILED  ${file}: ${error}`));
  logger.info(
    `Moved ${plural(result.removed.length, 'copy', 'copies')} to the trash` +
      (result.merged.length
        ? `, merged tags into ${plural(result.merged.length, 'kept copy', 'kept copies')}`
        : '') +
      (result.cleared.length
        ? `, cleared ${plural(result.cleared.length, 'live match', 'live matches')}`
        : '') +
      (result.removed.length ? `; musicman undo moves them back` : '')
  );
  return { groups, ...result };
};

/**
 * check --fix: the tag repairs of the fixable checks found (runTagFix), then the duplicates
 * (runDuplicateFix), and a note naming the checks found that need a decision per song.
 */
const runFix = async ({ db, config, target, results, switches, confirm, pick }) => {
  const found = _.filter(results, ({ findings }) => findings.length > 0);
  const hasDuplicates = _.some(found, { name: 'duplicates' });
  const tags = await runTagFix({
    db,
    config,
    target,
    results,
    switches,
    confirm,
    quiet: hasDuplicates
  });
  const duplicates = hasDuplicates
    ? await runDuplicateFix({ db, config, results, switches, confirm, pick })
    : null;
  const manual = _.map(
    _.reject(found, ({ name }) => fixableChecks.includes(name) || name === 'duplicates'),
    'name'
  );
  if (manual.length > 0) {
    logger.info(`No automatic repair for ${manual.join(', ')}: they need a decision per song`);
  }
  return {
    ...tags,
    duplicates,
    failed: [...tags.failed, ..._.get(duplicates, 'failed', [])]
  };
};

/**
 * check: reports problems in the library without changing anything: database drift, unreadable files,
 * frames a rewrite would lose, custom field names that differ by case or duplicate standard frames,
 * leftover Spotify id frames, multi value formatting and case variants, ratings off the half step scale,
 * garbled text, and duplicate songs. Resolves to the results; the command exits non-zero when something
 * is found. Dependencies (tests): openDb, listFiles.
 */
const checkCommand = async ({
  target,
  options = { switches: {} },
  config,
  openDb = () => openLibrary(config),
  list = listFiles,
  confirm = process.stdin.isTTY ? confirmPrompt : null,
  pick = process.stdin.isTTY ? pickWithFzf : null
}) => {
  const { switches = {} } = options;
  const selected = selectChecks(switches.only);
  if (!fs.existsSync(config.db.path)) {
    throw new Error(`No library database at ${config.db.path}, run: musicman db --update`);
  }
  const db = openDb();
  const checkTarget = target || config.mpd.baseDirectory;
  let results;
  let fixed = null;
  try {
    results = await runChecks({
      db,
      config,
      target: checkTarget,
      selected,
      listFiles: list,
      onProgress: phaseProgress('Reading tags', 'files')
    });
    logger.progressDone();
    if (switches.fix) {
      if (switches.format !== 'json') {
        _.each(renderReport(results, { all: switches.all }), line => logger.consoleLog(line));
      }
      fixed = await runFix({ db, config, target: checkTarget, results, switches, confirm, pick });
    }
  } finally {
    logger.progressDone();
    db.close();
  }
  // repairs leave the exit status to failed writes; the report was printed before them
  if (fixed) {
    if (fixed.failed.length > 0) {
      process.exitCode = 1;
    }
    return { results, fixed };
  }
  if (switches.format === 'json') {
    process.stdout.write(
      `${JSON.stringify({ checks: _.map(results, ({ name, findings }) => ({ name, count: findings.length, findings })) }, null, 2)}\n`
    );
  } else {
    _.each(renderReport(results, { all: switches.all }), line => logger.consoleLog(line));
  }
  return results;
};

// non-zero exit when any check found something, for scripts and cron
const withExitStatus = func => async args => {
  const results = await func(args);
  if (_.isArray(results) && _.some(results, ({ findings }) => findings.length)) {
    process.exitCode = 1;
  }
  return results;
};

module.exports = {
  name: 'check',
  description:
    'Report library problems: drift, unreadable files, field names, duplicates, ratings, encoding',
  usage: `musicman check [target] [--only=${checkNames.join(',')}] [--all] [--format=json] [--fix [--dry-run]]`,
  switches: ['only', 'all', 'format', 'fix', 'dry-run'],
  // a repair that can write is a run musicman undo can take back
  archive: ({ fix, dryRun }) => Boolean(fix && !dryRun),
  completes: ['paths'],
  func: withExitStatus(reportErrors(checkCommand)),
  run: checkCommand,
  // without a target the whole library is checked
  defaultTarget: baseDirectory => baseDirectory
};
