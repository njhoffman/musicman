#!/usr/bin/env node
// Downloads the tracks of the sync --pull manifest with spotDL into sync.downloadDirectory. Tracks that
// were downloaded or imported already are skipped, so a cancelled run resumes where it stopped. Run
// musicman sync --import afterwards to tag the downloads and import them with beets.
//
//   pnpm download [--dry-run] [--limit N]   (--limit: only the first N pending tracks, e.g. for a trial)
//
// Each run is archived as a download run (musicman logs), so musicman ui sees it and a second download
// never starts beside it. Stopped with ctrl-c or SIGTERM (Cancel in musicman ui), it stops spotDL,
// deletes the file of the track cut short, and archives the run as interrupted.
const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn: spawnChild } = require('child_process');
const path = require('path');
const { loadConfig } = require('musicman-common/config');

const {
  downloadTrackId,
  downloadedFiles,
  isCompleteDownload,
  manifestPath,
  pendingTracks,
  readManifest,
  removePartialDownloads,
  spotdlCommand
} = require('../lib/sync/download.js');
const { finishRun, runningRuns, runsDirectory, startRun } = require('../lib/utils/runs.js');

// tracks passed to each spotDL run, so progress is kept between runs of a long download
const batchSize = 20;

// the archived run's command name, which musicman ui looks for
const runCommand = 'download';

// signals that stop a download: ctrl-c, Cancel in musicman ui (SIGTERM), a closed terminal
const stopSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Runs a command and resolves to { status, error } when it exits; onChild(child) gets the process so a
 * stop can end it. Asynchronous, so a stop signal is handled while spotDL runs.
 */
const runCommandAsync = (command, args, options, onChild = () => {}) =>
  new Promise(resolve => {
    const child = spawnChild(command, args, options);
    onChild(child);
    child.on('error', error => resolve({ status: null, error }));
    child.on('exit', (status, signal) => resolve({ status, signal }));
  });

/**
 * Pids of ffmpeg processes writing into directory: spotDL runs ffmpeg outside its process group, so
 * stopping spotDL (or its group) leaves a conversion running; its output path names the directory.
 * Only ffmpeg is matched, never another program that names the directory (an editor, a tail).
 */
const strayProcesses = (
  directory,
  { list = () => execFileSync('ps', ['-eo', 'pid=,args=']) } = {}
) => {
  const prefix = `${path.resolve(directory)}${path.sep}`;
  return _.compact(
    `${list()}`.split('\n').map(line => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      const pid = match && Number(match[1]);
      const program = match ? path.basename(match[2].split(/\s/)[0]) : '';
      return pid && program === 'ffmpeg' && match[2].includes(prefix) ? pid : null;
    })
  );
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ends the stray conversions (strayProcesses), waiting up to a few seconds for them to exit
const stopStrays = async (directory, { find = strayProcesses, kill = process.kill } = {}) => {
  const pids = find(directory);
  pids.forEach(pid => {
    try {
      kill(pid, 'SIGTERM');
    } catch {
      // gone already
    }
  });
  for (let i = 0; i < 20 && pids.length && find(directory).length; i += 1) {
    await wait(100);
  }
  return pids;
};

// where spotDL keeps the YouTube audio it fetched until converted; a stopped download leaves it there
const spotdlTempDirectory = path.join(os.homedir(), '.spotdl', 'temp');
// temp files older than this are left over from stopped downloads (a running one is younger)
const staleTempMs = 24 * 3600 * 1000;

// deletes the files in spotDL's temp folder older than a day; returns their names
const removeStaleTemp = (directory = spotdlTempDirectory, now = Date.now()) => {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return _.compact(
    _.map(fs.readdirSync(directory), name => {
      const file = path.join(directory, name);
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || now - stat.mtimeMs < staleTempMs) {
          return null;
        }
        fs.unlinkSync(file);
        return name;
      } catch {
        return null;
      }
    })
  );
};

const parseLimit = args => {
  const limitArg = _.find(args, arg => arg.startsWith('--limit'));
  if (!limitArg) {
    return { limit: null };
  }
  const value =
    limitArg === '--limit' ? args[args.indexOf(limitArg) + 1] : `${limitArg}`.split('=')[1];
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? { limit } : { error: value };
};

/**
 * Downloads the pending manifest tracks; resolves to the exit code (0 when every track it tried is
 * downloaded, 1 otherwise, 130 when stopped). Dependencies (tests): spawn(command, args, options,
 * onChild) resolving to { status, error }, isComplete(file), archive (false: no run report),
 * signals (an EventEmitter for the stop signals, process by default), strays (stopStrays options), and
 * spotdlTemp (spotDL's temp folder, whose files older than a day are deleted first).
 */
const main = async ({
  args = process.argv.slice(2),
  config = loadConfig(),
  spawn = runCommandAsync,
  isComplete = isCompleteDownload,
  archive = true,
  signals = process,
  strays = {},
  spotdlTemp = spotdlTempDirectory
} = {}) => {
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const { limit, error: limitError } = parseLimit(args);
  if (limitError !== undefined) {
    console.error(`--limit needs a positive number, got '${limitError}'`);
    return 1;
  }
  const manifest = readManifest(config);
  if (!manifest) {
    console.error(`No manifest at ${manifestPath(config)}, run: musicman sync --pull`);
    return 1;
  }
  const directory = runsDirectory(config);
  if (!dryRun) {
    const runs = runningRuns(directory);
    const other = _.find(runs, { command: runCommand });
    if (other) {
      console.error(`A download is running already (pid ${other.pid}, since ${other.startedAt})`);
      return 1;
    }
    // an import takes every downloaded file, and would take one being written cut short
    const importing = _.find(
      runs,
      run => run.command === 'sync' && _.includes(run.args, '--import')
    );
    if (importing) {
      console.error(`An import is running (pid ${importing.pid}): download when it is done`);
      return 1;
    }
    const removed = removePartialDownloads(config, { isComplete });
    if (removed.length > 0) {
      console.log(`Removed ${removed.length} files of stopped downloads: ${removed.join(', ')}`);
    }
    // no other download runs (checked above), so spotDL's older temp files belong to none
    const stale = removeStaleTemp(spotdlTemp);
    if (stale.length > 0) {
      console.log(`Removed ${stale.length} leftover spotDL temp files from ${spotdlTemp}`);
    }
  }
  const allPending = pendingTracks(manifest, downloadedFiles(config));
  const pending = limit ? _.take(allPending, limit) : allPending;
  const total = _.get(manifest, 'tracks', []).length;
  console.log(
    `${allPending.length} of ${total} manifest tracks to download${
      limit && pending.length < allPending.length ? `, the first ${pending.length} now` : ''
    }`
  );
  if (pending.length === 0) {
    return 0;
  }
  if (dryRun) {
    pending.forEach(track => console.log(`  ${track.artists} - ${track.name}  ${track.url}`));
    return 0;
  }
  fs.mkdirSync(config.sync.downloadDirectory, { recursive: true });
  const run = archive ? startRun({ command: runCommand, args, config }) : null;

  let stopped = null;
  let child = null;
  const stop = signal => {
    stopped = signal;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
    }
  };
  stopSignals.forEach(signal => signals.on(signal, stop));

  let failed = 0;
  const runSpotdl = async tracks => {
    if (stopped) {
      return false;
    }
    const [command, commandArgs, options] = spotdlCommand(config, _.map(tracks, 'url'));
    const result = await spawn(command, commandArgs, { ...options, stdio: 'inherit' }, started => {
      child = started;
    });
    child = null;
    if (stopped) {
      return false;
    }
    if (result.error || result.status !== 0) {
      failed += 1;
      console.error(
        `spotDL ${result.error ? `failed: ${result.error.message}` : `exited with ${result.status}`}`
      );
      return false;
    }
    return true;
  };
  const notDownloaded = tracks => {
    const downloaded = new Set(
      _.compact(_.map(downloadedFiles(config), file => downloadTrackId(file)))
    );
    return _.reject(tracks, ({ trackId }) => downloaded.has(trackId));
  };

  try {
    const batches = _.chunk(pending, batchSize);
    for (const [i, batch] of batches.entries()) {
      if (stopped) {
        break;
      }
      console.log(`Batch ${i + 1}/${batches.length}`);
      // spotDL looks every track of a run up before downloading, so one track it cannot look up fails
      // the whole run: the tracks of a failed batch are tried again one by one
      const left = (await runSpotdl(batch)) ? [] : notDownloaded(batch);
      if (left.length > 1 && !stopped) {
        console.log(`Trying the ${left.length} tracks of batch ${i + 1} one by one`);
        for (const track of left) {
          await runSpotdl([track]);
        }
      }
    }
  } finally {
    stopSignals.forEach(signal => signals.removeListener(signal, stop));
  }

  if (stopped) {
    await stopStrays(config.sync.downloadDirectory, strays);
    const removed = removePartialDownloads(config, { isComplete });
    console.log(
      `Stopped (${stopped})${removed.length ? `, removed the unfinished ${removed.join(', ')}` : ''}`
    );
    if (run) {
      finishRun(run, { config, interrupted: true, exitCode: 130, result: { removed } });
    }
    return 130;
  }

  const stillPending = new Set(_.map(pendingTracks(manifest, downloadedFiles(config)), 'trackId'));
  const missedTracks = _.filter(pending, ({ trackId }) => stillPending.has(trackId));
  const missed = missedTracks.length;
  missedTracks.forEach(track =>
    console.log(`  missing: ${track.artists} - ${track.name}  ${track.url}`)
  );
  const later = stillPending.size - missed;
  console.log(
    `${pending.length - missed} downloaded, ${missed} still missing${
      failed ? ` (${failed} spotDL runs failed)` : ''
    }${later ? `, ${later} left for later runs` : ''}; next: musicman sync --import`
  );
  const exitCode = missed > 0 ? 1 : 0;
  if (run) {
    finishRun(run, {
      config,
      exitCode,
      result: {
        downloaded: pending.length - missed,
        missing: _.map(missedTracks, track => `${track.artists} - ${track.name}`),
        later
      }
    });
  }
  return exitCode;
};

if (require.main === module) {
  main().then(
    code => {
      process.exitCode = code;
    },
    err => {
      console.error(err.stack || err.message);
      process.exitCode = 1;
    }
  );
}

module.exports = { main, removeStaleTemp, runCommand, stopStrays, strayProcesses };
