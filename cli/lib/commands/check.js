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
  _.each(renderPlan(plan), line => logger.consoleLog(line));
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

const nothingDone = { removed: [], excluded: [], cleared: [], merged: [], failed: [] };

// the duplicate groups of the check results, planned (audio hashes read where a rule needs them)
const plannedDuplicates = (db, config, results) =>
  planDuplicates(
    duplicateGroups(db, _.get(_.find(results, { name: 'duplicates' }), 'findings', [])),
    { baseDirectory: path.resolve(config.mpd.baseDirectory) }
  );

const runIdNow = () =>
  activeRun() ||
  new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:]/g, '');

// what applying groups did, in one line
const duplicatesSummary = result =>
  _.upperFirst(
    _.compact([
      result.removed.length && `moved ${plural(result.removed.length, 'file')} to the trash`,
      result.excluded.length &&
        `dropped ${plural(result.excluded.length, 'copy', 'copies')} from the library (files kept)`,
      result.cleared.length &&
        `cleared ${plural(result.cleared.length, 'wrong match', 'wrong matches')} (sync --match finds their own tracks)`,
      result.merged.length &&
        `merged tags into ${plural(result.merged.length, 'kept copy', 'kept copies')}`
    ]).join(', ') || 'nothing changed'
  );

/**
 * check --fix for duplicates: plans each group (planDuplicates), shows the plan, and after one confirm
 * applies every group the rules decide (applyDuplicates), recorded for musicman undo. Groups that need
 * a pick are left for check --pick or the Duplicates tab of musicman ui. Without a terminal, or with
 * dryRun, only the plan is shown.
 */
const runDuplicateFix = async ({ db, config, results, switches, confirm }) => {
  const planned = plannedDuplicates(db, config, results);
  if (planned.length === 0) {
    return null;
  }
  const [toPick, decided] = _.partition(planned, ({ candidates }) => candidates.length > 0);
  _.each(renderDuplicatePlan(planned), line => logger.consoleLog(line));
  const pickNote = () =>
    toPick.length > 0 &&
    logger.info(
      `${plural(toPick.length, 'duplicate group')} need a pick: musicman check --pick, or the Duplicates tab of musicman ui`
    );
  if (switches.dryRun) {
    pickNote();
    return { groups: decided, toPick, ...nothingDone, dryRun: true };
  }
  if (decided.length === 0) {
    pickNote();
    return { groups: [], toPick, ...nothingDone };
  }
  if (!confirm) {
    logger.warn('Not a terminal to ask in, no duplicates changed (check --fix asks first)');
    return { groups: decided, toPick, ...nothingDone };
  }
  const count = key => _.sumBy(decided, group => group[key].length);
  const question = _.compact([
    count('trash') && `move ${plural(count('trash'), 'file')} to the trash`,
    count('exclude') &&
      `drop ${plural(count('exclude'), 'copy', 'copies')} from the library (files kept)`,
    count('clear') && `re-match ${plural(count('clear'), 'other recording')}`
  ]).join(', ');
  if (!(await confirm(`Repair ${plural(decided.length, 'duplicate group')}: ${question}?`))) {
    logger.info('No duplicates changed');
    pickNote();
    return { groups: decided, toPick, ...nothingDone };
  }
  const result = await applyDuplicates({
    db,
    config,
    groups: decided,
    runId: runIdNow(),
    onProgress: phaseProgress('Repairing duplicates', 'groups')
  });
  logger.progressDone();
  _.each(result.failed, ({ file, error }) => logger.warn(`FAILED  ${file}: ${error}`));
  logger.info(
    `${duplicatesSummary(result)}; musicman undo takes it back, sync --push removes the dropped tracks from Spotify`
  );
  pickNote();
  return { groups: decided, toPick, ...result };
};

const clock = seconds => {
  const total = Math.round(seconds || 0);
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
};

// a copy as a pick line: path, then what tells the copies apart
const copyLine = (baseDirectory, item, { sameAudio }) =>
  [
    `${path.join(baseDirectory, item.path)}\t${item.path}`,
    clock(item.duration),
    `${((item.size || 0) / 1048576).toFixed(1)} MB`,
    item.audio ? `crc ${item.audio.slice(0, 8)}${sameAudio ? ' (same)' : ''}` : 'crc ?',
    item.rating ? `rating ${item.rating}` : 'unrated',
    item.title ? `"${item.title}"` : 'no title'
  ].join('  ');

// how the copies of a group compare, for the pick header
const compareLine = files => {
  const sounds = _.compact(_.map(files, 'audio'));
  const lengths = _.uniq(_.map(files, item => clock(item.duration)));
  return [
    sounds.length === files.length && _.uniq(sounds).length === 1
      ? 'same audio'
      : 'different audio',
    lengths.length === 1 ? `same length ${lengths[0]}` : `lengths ${lengths.join(' / ')}`,
    _.uniq(_.map(files, 'title')).length === 1 ? 'same title' : 'different titles'
  ].join(', ');
};

/**
 * check --pick: the duplicate groups no rule decides, one at a time in fzf: each copy with its length,
 * size, audio CRC, rating, and title; the copy picked is kept and the others leave the library (files
 * kept), applied right away and recorded for musicman undo. skip (or esc) leaves a group for later,
 * stop ends the picking.
 */
const runDuplicatePick = async ({ db, config, results, pick }) => {
  const toPick = _.filter(
    plannedDuplicates(db, config, results),
    ({ candidates }) => candidates.length > 0
  );
  if (toPick.length === 0) {
    logger.info('No duplicate groups to pick');
    return { picked: 0, skipped: 0, ...nothingDone };
  }
  if (!pick) {
    logger.warn('check --pick needs a terminal to pick in');
    return { picked: 0, skipped: toPick.length, ...nothingDone };
  }
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const total = { picked: 0, skipped: 0, ...nothingDone, failed: [] };
  const runId = runIdNow();
  for (let i = 0; i < toPick.length; i += 1) {
    const group = toPick[i];
    const copies = _.filter(group.files, item => group.candidates.includes(item.path));
    const sameAudio = compareLine(copies).startsWith('same audio');
    const [choice] = pick(
      [
        ..._.map(copies, item => copyLine(baseDirectory, item, { sameAudio })),
        'skip\tskip: keep every copy for now',
        'stop\tstop: leave the rest for later'
      ],
      {
        multi: false,
        prompt: 'keep',
        header: `Duplicates ${i + 1}/${toPick.length}: ${compareLine(copies)}. The copy picked is kept, the others leave the library (files kept).`,
        preview: `test -f {1} && ${previewCommand('view')}`
      }
    );
    if (choice === 'stop') {
      total.skipped += toPick.length - i;
      break;
    }
    if (!choice || choice === 'skip') {
      total.skipped += 1;
      continue;
    }
    const result = await applyDuplicates({
      db,
      config,
      groups: [resolveGroup(group, path.relative(baseDirectory, choice))],
      runId
    });
    _.each(result.failed, ({ file, error }) => logger.warn(`FAILED  ${file}: ${error}`));
    _.each(['removed', 'excluded', 'cleared', 'merged', 'failed'], key =>
      total[key].push(...result[key])
    );
    total.picked += 1;
  }
  logger.info(
    `Picked ${plural(total.picked, 'group')}${total.skipped ? `, ${total.skipped} left for later` : ''}: ${duplicatesSummary(total)}`
  );
  return total;
};

/**
 * check --fix: the tag repairs of the fixable checks found (runTagFix), then the duplicates
 * (runDuplicateFix), and a note naming the checks found that need a decision per song.
 */
const runFix = async ({ db, config, target, results, switches, confirm }) => {
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
    ? await runDuplicateFix({ db, config, results, switches, confirm })
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
  // picking duplicates needs the duplicates check alone
  const selected = selectChecks(switches.pick ? 'duplicates' : switches.only);
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
    if (switches.pick) {
      fixed = await runDuplicatePick({ db, config, results, pick });
    } else if (switches.fix) {
      if (switches.format !== 'json') {
        _.each(renderReport(results), line => logger.consoleLog(line));
      }
      fixed = await runFix({ db, config, target: checkTarget, results, switches, confirm });
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
    _.each(renderReport(results), line => logger.consoleLog(line));
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
  usage: `musicman check [target] [--only=${checkNames.join(',')}] [--format=json] [--fix [--dry-run]] [--pick]`,
  switches: ['only', 'format', 'fix', 'dry-run', 'pick'],
  // a repair that can write is a run musicman undo can take back
  archive: ({ fix, pick, dryRun }) => Boolean((fix || pick) && !dryRun),
  completes: ['paths'],
  func: withExitStatus(reportErrors(checkCommand)),
  run: checkCommand,
  // without a target the whole library is checked
  defaultTarget: baseDirectory => baseDirectory
};
