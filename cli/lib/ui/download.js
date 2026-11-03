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

/**
 * Downloads run from musicman ui: the download script started as a detached process group, so it
 * keeps going when the page or the server closes, and Cancel can stop spotDL and its conversions
 * with it. A download running in a terminal shows as running and blocks a start, but only one the page
 * started can be cancelled here. Its output goes to download.log in sync.downloadDirectory.
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
  const logFile = directory ? path.join(directory, 'download.log') : null;
  // a download just started, before its run report is written
  let started = null;

  const current = () => {
    const run = _.find(running(), { command: downloadCommand });
    if (run) {
      return { pid: run.pid, startedAt: run.startedAt, id: run.id };
    }
    if (started && processAlive(started.pid, kill)) {
      return started;
    }
    started = null;
    return null;
  };

  // the download going on (null when none), the manifest tracks by state, and the page's output
  const status = () => {
    const counts = _.countBy([...downloadStatus(config).values()]);
    const run = current();
    const fromPage = Boolean(run && run.pid && leadsGroup(run.pid, kill));
    return {
      running: run ? { ...run, fromPage } : null,
      queued: counts.queued || 0,
      downloaded: counts.downloaded || 0,
      imported: counts.imported || 0,
      log: logFile && (fromPage || !run) ? logTail(logFile) : []
    };
  };

  const start = () => {
    if (!directory || !readManifest(config)) {
      throw new DownloadError(400, 'No download manifest yet: add tracks to downloads first');
    }
    const run = current();
    if (run) {
      throw new DownloadError(409, `A download is running already (pid ${run.pid})`);
    }
    fs.mkdirSync(directory, { recursive: true });
    const fd = fs.openSync(logFile, 'w');
    let child;
    try {
      child = spawnProcess(nodePath, [script], {
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

  // stops the download the page started: the script stops spotDL and removes the unfinished file
  const cancel = () => {
    const run = current();
    if (!run) {
      throw new DownloadError(409, 'No download is running');
    }
    if (!leadsGroup(run.pid, kill)) {
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

module.exports = { DownloadError, downloadCommand, downloadJobs, downloadScript, logTail };
