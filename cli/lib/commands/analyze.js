const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const NodeId3 = require('node-id3');

const {
  analysisFields,
  analysisWrites,
  runAnalysis,
  songsToAnalyze
} = require('../analyze/essentia.js');
const {
  idleReady,
  idleSettings,
  loadAverages,
  lockFile,
  lockHolder,
  onBattery,
  takeLock,
  watchIdle
} = require('../analyze/idle.js');
const { openLibrary, updateDatabase } = require('../db/index.js');
const { readTagBuffer } = require('../metadata/tagBuffer.js');
const { updateTags } = require('../metadata/write.js');
const { progressBar } = require('../output/progress.js');
const { confirm: confirmPrompt } = require('../utils/confirm.js');
const logger = require('../utils/logger.js');

// worker processes, unless analyze.workers says otherwise; seconds a worker takes per file (measured
// 2026-11-03: about 13 to 20), for the estimate
const defaultWorkers = 4;
const secondsPerFile = 16;
// files written between database updates
const updateEvery = 25;

// the TBPM and TKEY a file has now, which analyze leaves alone
const currentKeyAndTempo = file => {
  try {
    const tag = readTagBuffer(file);
    const raw = tag ? _.get(NodeId3.read(tag), 'raw', {}) : {};
    return { TBPM: raw.TBPM || null, TKEY: raw.TKEY || null };
  } catch {
    return {};
  }
};

/**
 * Whether analyze --idle should work now (idleReady): the load, AC power, the lock, and songs left in
 * the library database. Also decides whether the run is archived, so a timer run that does nothing
 * leaves nothing in musicman logs and undo. Dependencies (tests): load, battery, holder, openDb.
 */
const idleCheck = (
  config,
  {
    load = loadAverages,
    battery = onBattery,
    holder = () => lockHolder(lockFile()),
    openDb = () => (fs.existsSync(_.get(config, 'db.path') || '') ? openLibrary(config) : null)
  } = {}
) =>
  idleReady({
    settings: idleSettings(config),
    load: load(),
    battery: battery(),
    holder: holder(),
    left: () => {
      const db = openDb();
      if (!db) {
        return 0;
      }
      try {
        return songsToAnalyze(db).length;
      } finally {
        db.close();
      }
    }
  });

const hours = seconds =>
  seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} hours` : `${Math.ceil(seconds / 60)} minutes`;

/**
 * analyze: analyses the library's files with Essentia (tempo, key, danceability, moods), the songs
 * not analysed yet (--refresh: all, --limit N: the first N), after a confirmation (--yes: without).
 * Each file's tags are written as its analysis arrives, so a run stopped with ctrl-c goes on from there
 * next time. Recorded for musicman undo; the database is updated every 25 files and at the end.
 * --idle is the background run (the musicman-analyze timer): it starts only when idleCheck says so, with
 * analyze.idle.workers and no question, and finishes the files in progress and stops once the computer
 * goes on battery or other processes keep it busy (watchIdle). Manual and background runs hold one lock,
 * so they never analyse at the same time.
 * Dependencies (tests): confirm, run (runAnalysis), openDb, currentTags, check (idleCheck), lock
 * (takeLock), watch (watchIdle).
 */
const analyzeCommand = async ({
  options = {},
  config,
  confirm = confirmPrompt,
  run = runAnalysis,
  openDb = () => openLibrary(config),
  currentTags = currentKeyAndTempo,
  check = () => idleCheck(config),
  lock = () => takeLock(lockFile()),
  watch = watchIdle
}) => {
  const switches = _.get(options, 'switches', {});
  const idle = Boolean(switches.idle);
  if (idle && (switches.refresh || switches.limit || switches.dryRun)) {
    throw new Error(
      'analyze --idle takes no other switches: it analyses the songs left, in the background'
    );
  }
  if (idle) {
    const { ready, reason } = check();
    if (!ready) {
      logger.info(`Not analysing now: ${reason}`);
      return { analyze: { songs: 0, written: 0, idle: reason } };
    }
  }
  let release;
  try {
    release = lock();
  } catch (err) {
    if (idle) {
      logger.info(`Not analysing now: ${err.message}`);
      return { analyze: { songs: 0, written: 0, idle: err.message } };
    }
    throw new Error(
      err.holder
        ? `${err.message}, the background one stops with: systemctl --user stop musicman-analyze`
        : err.message,
      { cause: err }
    );
  }
  try {
    return await analyzeSongs({
      switches,
      idle,
      config,
      confirm,
      run,
      openDb,
      currentTags,
      watch
    });
  } finally {
    release();
  }
};

const analyzeSongs = async ({
  switches,
  idle,
  config,
  confirm,
  run,
  openDb,
  currentTags,
  watch
}) => {
  const fields = _.get(config, 'analyze.fields') || analysisFields;
  const settings = idleSettings(config);
  const workers = idle ? settings.workers : _.get(config, 'analyze.workers') || defaultWorkers;
  const limit = switches.limit ? Number(switches.limit) : null;
  if (switches.limit && !(Number.isInteger(limit) && limit > 0)) {
    throw new Error(`--limit needs a positive number, got '${switches.limit}'`);
  }
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const db = openDb();
  try {
    const songs = songsToAnalyze(db, { refresh: Boolean(switches.refresh), limit });
    const estimate = hours((songs.length * secondsPerFile) / Math.max(1, workers));
    logger.info(
      `${songs.length} songs to analyse with Essentia, about ${estimate} with ${workers} workers`
    );
    if (songs.length === 0 || switches.dryRun) {
      return { analyze: { songs: songs.length, written: 0, dryRun: Boolean(switches.dryRun) } };
    }
    const question = `Analyse ${songs.length} songs (about ${estimate}) and write ${fields.join(', ')}?`;
    if (!idle && !switches.yes && !(await confirm(question))) {
      logger.info('Analysis cancelled');
      return { analyze: { songs: songs.length, written: 0 } };
    }
    const written = [];
    const failed = [];
    let pending = [];
    let updates = Promise.resolve();
    const flush = () => {
      const files = pending;
      pending = [];
      if (files.length > 0) {
        updates = updates.then(() => updateDatabase(db, { config, files }));
      }
      return updates;
    };
    const startedAt = new Date();
    let done = 0;
    let stoppedBy = null;
    const {
      done: finished,
      finish = _.noop,
      active = () => workers
    } = run({
      files: _.map(songs, songPath => path.join(baseDirectory, songPath)),
      workers,
      onLog: line => logger.logToFile('debug', `essentia: ${line}`),
      onResult: result => {
        done += 1;
        const relative = path.relative(baseDirectory, result.file);
        if (result.error || !fs.existsSync(result.file)) {
          failed.push({ file: relative, error: result.error || 'file is gone' });
        } else {
          const { custom, standard } = analysisWrites(result, {
            fields,
            current: currentTags(result.file)
          });
          const write = updateTags(
            {
              userDefinedText: _.map(custom, ({ name, value }) => ({ description: name, value })),
              ...standard
            },
            result.file
          );
          if (write instanceof Error) {
            failed.push({ file: relative, error: write.message });
          } else {
            written.push(relative);
            pending.push(result.file);
            if (pending.length >= updateEvery) {
              flush();
            }
          }
        }
        logger.progress(progressBar({ done, total: songs.length, startedAt, label: 'Analysing' }));
      }
    });
    const unwatch = idle
      ? watch({
          settings,
          workers: active,
          stop: reason => {
            stoppedBy = reason;
            logger.info(`Stopping once the files in progress are done: ${reason}`);
            finish();
          }
        })
      : _.noop;
    await finished;
    unwatch();
    await flush();
    logger.progressDone();
    failed.forEach(({ file, error }) => logger.warn(`FAILED  ${file}: ${error}`));
    logger.info(
      `Analysed ${written.length} songs${failed.length ? `, ${failed.length} failed` : ''}` +
        `${written.length + failed.length < songs.length ? `; ${songs.length - written.length - failed.length} left for the next run` : ''}` +
        `${stoppedBy ? ` (stopped: ${stoppedBy})` : ''}`
    );
    return {
      analyze: {
        songs: songs.length,
        written: written.length,
        failed,
        ...(stoppedBy ? { stopped: stoppedBy } : {})
      }
    };
  } finally {
    db.close();
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'analyze',
  description:
    'Analyse the library files with Essentia: tempo and key where missing, danceability, and mood probabilities',
  usage: 'musicman analyze [--refresh] [--limit N] [--dry-run] [--yes] | --idle',
  switches: ['refresh', 'limit', 'dry-run', 'yes', 'idle'],
  switchHelp: {
    idle: 'The background run (musicman-analyze timer): only when idle on AC power, stopping when busy',
    refresh: 'Analyse every song again, not only the ones not analysed yet',
    'dry-run': 'Show how many songs would be analysed and the time estimate, without analysing',
    yes: 'Start without asking first'
  },
  func: analyzeCommand,
  run: analyzeCommand,
  // a background run that will not analyse anything (busy, on battery, nothing left) is not archived
  archive: (switches, config) => (switches.idle ? idleCheck(config).ready : !switches.dryRun),
  idleCheck,
  defaultTarget,
  targetArgs: false,
  terms: false
};
