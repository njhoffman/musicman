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

const hours = seconds =>
  seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} hours` : `${Math.ceil(seconds / 60)} minutes`;

/**
 * analyze: analyses the library's files with Essentia (tempo, key, danceability, moods), the songs
 * not analysed yet (--refresh: all, --limit N: the first N), after a confirmation (--yes: without).
 * Each file's tags are written as its analysis arrives, so a run stopped with ctrl-c goes on from there
 * next time. Recorded for musicman undo; the database is updated every 25 files and at the end.
 * Dependencies (tests): confirm, run (runAnalysis), openDb, currentTags.
 */
const analyzeCommand = async ({
  options = {},
  config,
  confirm = confirmPrompt,
  run = runAnalysis,
  openDb = () => openLibrary(config),
  currentTags = currentKeyAndTempo
}) => {
  const switches = _.get(options, 'switches', {});
  const fields = _.get(config, 'analyze.fields') || analysisFields;
  const workers = _.get(config, 'analyze.workers') || defaultWorkers;
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
    if (!switches.yes && !(await confirm(question))) {
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
    const { done: finished } = run({
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
    await finished;
    await flush();
    logger.progressDone();
    failed.forEach(({ file, error }) => logger.warn(`FAILED  ${file}: ${error}`));
    logger.info(
      `Analysed ${written.length} songs${failed.length ? `, ${failed.length} failed` : ''}` +
        `${written.length + failed.length < songs.length ? `; ${songs.length - written.length - failed.length} left for the next run` : ''}`
    );
    return { analyze: { songs: songs.length, written: written.length, failed } };
  } finally {
    db.close();
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'analyze',
  description:
    'Analyse the library files with Essentia: tempo and key where missing, danceability, and mood probabilities',
  usage: 'musicman analyze [--refresh] [--limit N] [--dry-run] [--yes]',
  switches: ['refresh', 'limit', 'dry-run', 'yes'],
  switchHelp: {
    refresh: 'Analyse every song again, not only the ones not analysed yet',
    'dry-run': 'Show how many songs would be analysed and the time estimate, without analysing',
    yes: 'Start without asking first'
  },
  func: analyzeCommand,
  archive: ({ dryRun }) => !dryRun,
  defaultTarget,
  targetArgs: false,
  terms: false
};
