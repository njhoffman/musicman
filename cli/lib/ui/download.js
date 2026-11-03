const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { readManifest } = require('../sync/download.js');
const { downloadStatus } = require('../sync/pull.js');

// the download script (pnpm download), started by the page as its own process group
const downloadScript = path.join(__dirname, '..', '..', 'scripts', 'spotdl-download.js');

// the archived run's command name the script uses
const downloadCommand = 'download';

// lines of the page's download output shown in the page, and the bytes read to find them
const logLines = 12;
const logTailBytes = 16 * 1024;

// spotDL draws progress with escape sequences and carriage returns
// eslint-disable-next-line no-control-regex
const ansiPattern = /\u001b\[[0-9;?]*[A-Za-z]/g;

// the last lines of a log, without escape sequences or the progress redraws between them
const logTail = (file, lines = logLines) => {
  try {
    const { size } = fs.statSync(file);
    const start = Math.max(0, size - logTailBytes);
    const buffer = Buffer.alloc(size - start);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      fs.closeSync(fd);
    }
    return _.takeRight(
      _.compact(
        _.map(
          buffer
            .toString('utf8')
            .replace(ansiPattern, '')
            .split(/[\r\n]+/),
          line => line.trimEnd()
        )
      ),
      lines
    );
  } catch {
    return [];
  }
};

// whether a process group led by pid exists: true for a download the page started (detached)
const leadsGroup = (pid, kill = process.kill) => {
  try {
    kill(-pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

const processAlive = (pid, kill = process.kill) => {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

class DownloadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// the cli, run by the page for sync --import
const cliScript = path.join(__dirname, '..', 'cli.js');

// whether a run report is an import (musicman sync --import)
const isImportRun = run => run.command === 'sync' && _.includes(run.args, '--import');

/**
 * A command the page starts as a detached process group, so it keeps going when the page or the
 * server closes, its output in logFile. isRun(report) picks its runs among the running runs, so a run
 * started in a terminal counts too; one the page started leads its own process group (fromPage).
 */
const detachedJob = ({ isRun, logFile, running, spawnProcess, kill, nodePath }) => {
  // a run just started, before its run report is written
  let started = null;

  const current = () => {
    const run = _.find(running(), isRun);
    if (run) {
      return { pid: run.pid, startedAt: run.startedAt, id: run.id };
    }
    if (started && processAlive(started.pid, kill)) {
      return started;
    }
    started = null;
    return null;
  };

  const fromPage = run => Boolean(run && run.pid && leadsGroup(run.pid, kill));

  const launch = (script, args) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, 'w');
    let child;
    try {
      child = spawnProcess(nodePath, [script, ...args], {
        cwd: path.dirname(path.dirname(script)),
        detached: true,
        stdio: ['ignore', fd, fd]
      });
    } finally {
      fs.closeSync(fd);
    }
    child.unref();
    started = { pid: child.pid, startedAt: new Date().toISOString(), id: null };
    return { started: true, pid: child.pid };
  };

  // the run going on (null when none) and the page's output (none for a run in a terminal)
  const describe = () => {
    const run = current();
    const page = fromPage(run);
    return {
      running: run ? { ...run, fromPage: page } : null,
      log: page || !run ? logTail(logFile) : []
    };
  };

  return { current, fromPage, launch, describe };
};

/**
 * Downloads run from musicman ui: the download script, detached (detachedJob), so Cancel can stop
 * spotDL and its conversions with it. A download running in a terminal shows as running and blocks a
 * start, but only one the page started can be cancelled here. Its output goes to download.log in
 * sync.downloadDirectory. A download never starts beside an import, which would take its files.
 * Dependencies: running() the running runs (runningRuns), spawnProcess, kill (process.kill), script.
 */
const downloadJobs = ({
  config,
  running,
  spawnProcess = spawn,
  kill = process.kill,
  script = downloadScript,
  nodePath = process.execPath
}) => {
  const directory = _.get(config, 'sync.downloadDirectory');
  const job = detachedJob({
    isRun: { command: downloadCommand },
    logFile: directory ? path.join(directory, 'download.log') : null,
    running,
    spawnProcess,
    kill,
    nodePath
  });

  // the download going on (null when none), the manifest tracks by state, and the page's output
  const status = () => {
    const counts = _.countBy([...downloadStatus(config).values()]);
    return {
      ...job.describe(),
      queued: counts.queued || 0,
      downloaded: counts.downloaded || 0,
      imported: counts.imported || 0
    };
  };

  // limit: download only the first limit queued tracks (a trial), all without it
  const start = ({ limit = null } = {}) => {
    if (!directory || !readManifest(config)) {
      throw new DownloadError(400, 'No download manifest yet: add tracks to downloads first');
    }
    if (limit !== null && !(Number.isInteger(limit) && limit > 0)) {
      throw new DownloadError(400, 'limit must be a positive whole number');
    }
    const run = job.current();
    if (run) {
      throw new DownloadError(409, `A download is running already (pid ${run.pid})`);
    }
    if (_.find(running(), isImportRun)) {
      throw new DownloadError(409, 'An import is running: download when it is done');
    }
    return job.launch(script, limit ? ['--limit', `${limit}`] : []);
  };

  // stops the download the page started: the script stops spotDL and removes the unfinished file
  const cancel = () => {
    const run = job.current();
    if (!run) {
      throw new DownloadError(409, 'No download is running');
    }
    if (!job.fromPage(run)) {
      throw new DownloadError(
        409,
        'The download was started in a terminal: stop it there with ctrl-c'
      );
    }
    kill(-run.pid, 'SIGTERM');
    return { cancelled: true, pid: run.pid };
  };

  return { status, start, cancel };
};

/**
 * Imports run from musicman ui: musicman sync --import --yes, detached (detachedJob), its output in
 * import.log in sync.downloadDirectory. It writes the library, so the page asks before accepting while it
 * runs (it is a sync run); there is no cancel, a stop in the middle of a beets import leaves files to
 * recover. It never starts beside a download, whose unfinished files it would take.
 */
const importJobs = ({
  config,
  running,
  spawnProcess = spawn,
  kill = process.kill,
  cli = cliScript,
  nodePath = process.execPath
}) => {
  const directory = _.get(config, 'sync.downloadDirectory');
  const job = detachedJob({
    isRun: isImportRun,
    logFile: directory ? path.join(directory, 'import.log') : null,
    running,
    spawnProcess,
    kill,
    nodePath
  });

  const status = () => job.describe();

  const start = () => {
    if (!directory || !readManifest(config)) {
      throw new DownloadError(400, 'No download manifest yet: nothing to import');
    }
    const run = job.current();
    if (run) {
      throw new DownloadError(409, `An import is running already (pid ${run.pid})`);
    }
    if (_.find(running(), { command: downloadCommand })) {
      throw new DownloadError(409, 'A download is running: import when it is done');
    }
    return job.launch(cli, ['sync', '--import', '--yes']);
  };

  return { status, start };
};

module.exports = {
  DownloadError,
  downloadCommand,
  downloadJobs,
  downloadScript,
  importJobs,
  isImportRun,
  logTail
};
