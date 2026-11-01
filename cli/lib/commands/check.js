const _ = require('lodash');
const fs = require('fs');

const { reportErrors } = require('./common.js');
const { checkNames, runChecks, selectChecks } = require('../check/index.js');
const { openLibrary } = require('../db/index.js');
const { listFiles } = require('../db/update.js');
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
  list = listFiles
}) => {
  const { switches = {} } = options;
  const selected = selectChecks(switches.only);
  if (!fs.existsSync(config.db.path)) {
    throw new Error(`No library database at ${config.db.path}, run: musicman db --update`);
  }
  const db = openDb();
  let results;
  try {
    results = await runChecks({
      db,
      config,
      target: target || config.mpd.baseDirectory,
      selected,
      listFiles: list,
      onProgress: (done, total) => logger.progress(`reading tags ${done}/${total}`)
    });
  } finally {
    logger.progressDone();
    db.close();
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
  usage: `musicman check [target] [--only=${checkNames.join(',')}] [--all] [--format=json]`,
  switches: ['only', 'all', 'format'],
  completes: ['paths'],
  func: withExitStatus(reportErrors(checkCommand)),
  run: checkCommand,
  // without a target the whole library is checked
  defaultTarget: baseDirectory => baseDirectory,
  renderReport
};
