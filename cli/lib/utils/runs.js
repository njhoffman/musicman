const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');

const logger = require('./logger.js');

// archived runs default to $XDG_STATE_HOME/musicman/logs, next to the Spotify login token
const runsDirectory = (config, env = process.env) =>
  _.get(config, 'logger.archive.directory') ||
  path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'musicman', 'logs');

const pad = number => `${number}`.padStart(2, '0');

// run ids sort by start time: 20261020-193512-sync, with a counter when a second has two runs
const runId = (command, now, directory) => {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const base = `${stamp}-${command}`;
  let id = base;
  for (let n = 2; fs.existsSync(path.join(directory, `${id}.json`)); n += 1) {
    id = `${base}-${n}`;
  }
  return id;
};

const runFiles = (directory, id) => ({
  logFile: path.join(directory, `${id}.log`),
  reportFile: path.join(directory, `${id}.json`)
});

// whether a command archives this run: commands set archive to true or to a function of the switches
const archives = (command, switches = {}) =>
  _.isFunction(command.archive) ? Boolean(command.archive(switches)) : Boolean(command.archive);

/**
 * Starts archiving a run: everything logged until finishRun is also written to <id>.log in the runs
 * directory, at logger.archive.level.
 */
const startRun = ({ command, args, config, env = process.env, now = new Date() }) => {
  const directory = runsDirectory(config, env);
  fs.mkdirSync(directory, { recursive: true });
  const id = runId(command, now, directory);
  const run = { id, command, args, directory, startedAt: now, ...runFiles(directory, id) };
  // the report is written at the start so a run that crashes is still listed
  fs.writeFileSync(
    run.reportFile,
    `${JSON.stringify({ id, command, args, startedAt: now.toISOString(), status: 'running' })}\n`
  );
  logger.configureRunLog({ name: run.logFile, level: _.get(config, 'logger.archive.level') });
  return run;
};

// JSON of a command result, values that cannot be serialized are left out instead of failing the run
const serializable = result => {
  try {
    return JSON.parse(JSON.stringify(result === undefined ? null : result));
  } catch (err) {
    return { unserializable: err.message };
  }
};

// oldest runs of command beyond keep, newest first by id
const pruneRuns = (directory, command, keep) => {
  const ids = _.filter(
    _.map(
      fs.readdirSync(directory).filter(name => name.endsWith('.json')),
      name => name.slice(0, -5)
    ),
    id => id.replace(/^\d{8}-\d{6}-/, '').replace(/-\d+$/, '') === command
  )
    .sort()
    .reverse();
  const removed = ids.slice(keep);
  removed.forEach(id => _.each(runFiles(directory, id), file => fs.rmSync(file, { force: true })));
  return removed;
};

/**
 * Finishes an archived run: writes <id>.json with the command result (or error, or interrupted when
 * stopped by a signal), stops the run log,
 * and removes the command's runs beyond logger.archive.keep.
 */
const finishRun = (
  run,
  { config, result, error, exitCode = 0, interrupted = false, now = new Date() }
) => {
  const report = {
    id: run.id,
    command: run.command,
    args: run.args,
    startedAt: run.startedAt.toISOString(),
    finishedAt: now.toISOString(),
    seconds: (now - run.startedAt) / 1000,
    status: (interrupted && 'interrupted') || (error || exitCode ? 'failed' : 'ok'),
    exitCode: error && !exitCode ? 1 : exitCode,
    error: error ? error.message : undefined,
    result: serializable(result)
  };
  logger.configureRunLog();
  fs.writeFileSync(run.reportFile, `${JSON.stringify(report, null, 2)}\n`);
  pruneRuns(run.directory, run.command, _.get(config, 'logger.archive.keep', 200));
  return report;
};

// reports of archived runs, newest first; unreadable reports are skipped
const listRuns = directory => {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return _.compact(
    fs
      .readdirSync(directory)
      .filter(name => name.endsWith('.json'))
      .sort()
      .reverse()
      .map(name => {
        try {
          return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        } catch {
          return null;
        }
      })
  );
};

module.exports = {
  archives,
  finishRun,
  listRuns,
  pruneRuns,
  runFiles,
  runsDirectory,
  startRun
};
