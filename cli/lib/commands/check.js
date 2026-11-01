const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const { reportErrors } = require('./common.js');
const { checkNames, runChecks, selectChecks } = require('../check/index.js');
const { applyFixes, fixableChecks, planFixes } = require('../check/fix.js');
const { openLibrary } = require('../db/index.js');
const { listFiles, updateDatabase } = require('../db/update.js');
const { confirm: confirmPrompt } = require('../utils/confirm.js');
const logger = require('../utils/logger.js');

// findings listed per check unless --all
const shownPerCheck = 10;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// the report: per check its count and description, then its findings (the first shownPerCheck)
const renderReport = (results, { all = false } = {}) => {
  const lines = [];
  _.each(results, ({ name, description, unit, findings }) => {
    if (findings.length === 0) {
      lines.push(`${name.padEnd(11)} ok          ${description}`);
      return;
    }
    lines.push(`${name.padEnd(11)} ${plural(findings.length, unit).padEnd(11)} ${description}`);
    const shown = all ? findings : _.take(findings, shownPerCheck);
    _.each(shown, ({ file, detail }) => lines.push(`    ${file ? `${file}  ` : ''}${detail}`));
    if (shown.length < findings.length) {
      lines.push(`    ... ${findings.length - shown.length} more (--all, or --only=${name} --all)`);
    }
  });
  const found = _.filter(results, ({ findings }) => findings.length);
  lines.push(
    found.length
      ? `${plural(found.length, 'check')} of ${results.length} found problems`
      : `No problems found in ${plural(results.length, 'check')}`
  );
  return lines;
};

// the planned changes per check, then the first shownPerCheck of each (all with --all)
const renderPlan = ({ files, skipped }, { all = false } = {}) => {
  const lines = [];
  const changes = _.flatMap(files, ({ file, changes: fileChanges }) =>
    _.map(fileChanges, item => ({ file, ...item }))
  );
  _.each(fixableChecks, name => {
    const of = _.filter(changes, { check: name });
    const left = _.filter(skipped, { check: name });
    if (of.length === 0 && left.length === 0) {
      return;
    }
    lines.push(
      `${name.padEnd(11)} ${plural(of.length, 'change')} in ${plural(_.uniqBy(of, 'file').length, 'file')}${left.length ? `, ${left.length} left for you` : ''}`
    );
    const shown = all ? of : _.take(of, shownPerCheck);
    _.each(shown, ({ file, text }) => lines.push(`    ${file}  ${text}`));
    if (shown.length < of.length) {
      lines.push(`    ... ${of.length - shown.length} more (--all)`);
    }
    _.each(all ? left : _.take(left, shownPerCheck), ({ file, text }) =>
      lines.push(`    left  ${file}  ${text}`)
    );
  });
  return lines;
};

/**
 * check --fix: after the report, plans the repairs of the fixable checks found (fixableChecks), shows
 * them, and after confirm writes every file's tag once (recorded for musicman undo by the run), then
 * brings the database up to date (drift). With dryRun, or without a terminal to ask in, nothing changes.
 */
const runFix = async ({ db, config, target, results, switches, confirm }) => {
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
    onProgress: (done, total) => logger.progress(`planning repairs ${done}/${total}`)
  });
  logger.progressDone();
  const drift = _.get(_.find(results, { name: 'drift' }), 'findings', []);
  if (plan.files.length === 0 && drift.length === 0) {
    logger.info('Nothing to repair');
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
    onProgress: (done, count) => logger.progress(`writing ${done}/${count}`)
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
  confirm = process.stdin.isTTY ? confirmPrompt : null
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
      onProgress: (done, total) => logger.progress(`reading tags ${done}/${total}`)
    });
    logger.progressDone();
    if (switches.fix) {
      if (switches.format !== 'json') {
        _.each(renderReport(results, { all: switches.all }), line => logger.consoleLog(line));
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
  defaultTarget: baseDirectory => baseDirectory,
  renderReport
};
