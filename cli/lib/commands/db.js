const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const { backupDatabase, getMeta, openLibrary, updateDatabase } = require('../db/index.js');
const { excludedSongs, exclusionOf, includeSong } = require('../db/exclusions.js');
const { findRestorable, listRestorable, restoreDatabase } = require('../db/restore.js');
const { recordFileMove } = require('../history/journal.js');
const { formatProgress, outputDbStats, outputUpdateSummary } = require('../output/db.js');
const { pickWithFzf } = require('../output/fzf.js');
const { renderColumns } = require('../output/render.js');
const { confirm: confirmPrompt } = require('../utils/confirm.js');
const logger = require('../utils/logger.js');
const { runningRuns, runsDirectory } = require('../utils/runs.js');

const fileSize = file => (fs.existsSync(file) ? fs.statSync(file).size : 0);

const getStats = (db, dbPath) => {
  const count = sql => Object.values(db.prepare(sql).get())[0] || 0;
  return {
    path: dbPath,
    size: fileSize(dbPath) + fileSize(`${dbPath}-wal`),
    schemaVersion: db.prepare('PRAGMA user_version').get().user_version,
    songs: count('SELECT COUNT(*) FROM songs'),
    rated: count('SELECT COUNT(*) FROM songs WHERE rating IS NOT NULL'),
    duration: count('SELECT SUM(duration) FROM songs'),
    tagValues: count('SELECT COUNT(*) FROM song_tags'),
    frames: count('SELECT COUNT(DISTINCT frame_id) FROM song_tags'),
    tagDefinitions: count('SELECT COUNT(*) FROM tags'),
    lastUpdate: getMeta(db, 'lastUpdate'),
    lastBackup: getMeta(db, 'lastBackup')
  };
};

const logBackup = backup => {
  if (backup) {
    logger.info(
      `Backed up database to ${backup.file}${
        backup.removed ? ` (removed ${backup.removed} old)` : ''
      }`
    );
  }
  return backup;
};

const runUpdate = async (db, { config, target }) => {
  logger.info(`Updating database from ${target}`);
  const startedAt = new Date();
  const summary = await updateDatabase(db, {
    config,
    target,
    onProgress: progress => logger.progress(formatProgress(progress, startedAt)),
    onFile: (action, file, detail) =>
      action === 'failed'
        ? logger.warn(`failed  ${file}: ${detail}`)
        : logger.logToFile(
            'debug',
            `${action.padEnd(7)} ${file}${detail ? ` (from ${detail})` : ''}`
          )
  });
  logger.progressDone();
  outputUpdateSummary(summary);
  return summary;
};

// SQLite's datetime('now') (UTC) as the local date, YYYY-MM-DD
const localDay = utc => {
  const date = new Date(`${`${utc}`.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime())
    ? `${utc}`.slice(0, 10)
    : [date.getFullYear(), date.getMonth() + 1, date.getDate()]
        .map(part => `${part}`.padStart(2, '0'))
        .join('-');
};

// an exclusion with its local date and whether its file is still in the library (a trashed copy is not)
const withFile = baseDirectory => row => ({
  ...row,
  day: localDay(row.excluded_at),
  inLibrary: fs.existsSync(path.join(baseDirectory, row.path))
});

const exclusionLine = row =>
  `${row.day}  ${row.path}  (${row.reason || 'no reason'}${
    row.inLibrary ? '' : ', in the trash'
  })`;

// db --excluded: the songs taken out of the library whose files stay (or went to the trash)
const listExcluded = (db, { config }) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const rows = _.map(excludedSongs(db), withFile(baseDirectory));
  if (rows.length === 0) {
    logger.info('No songs are excluded from the library');
    return rows;
  }
  logger.info(
    `${rows.length} songs excluded from the library (db --readmit [path] lets one back in)\n${renderColumns({
      head: ['Excluded', 'Path', 'Reason', 'Kept instead'],
      rows: _.map(rows, row => [
        row.day,
        `${row.path}${row.inLibrary ? '' : ' (in the trash)'}`,
        row.reason || '',
        row.kept || ''
      ]),
      columns: [{}, { maxWidth: 90 }, { maxWidth: 40 }, { maxWidth: 70 }],
      splitter: '   ',
      maxLineWidth: process.stdout.columns || Infinity
    })}`
  );
  return rows;
};

/**
 * db --readmit [path]: lets excluded songs back in: a file target is that song, a directory (the whole
 * library without a target) picks among the exclusions under it with fzf. A trashed copy has to be moved
 * back first (musicman undo, or by hand). Each is read into the database again and recorded for undo.
 */
const readmit = async (db, { config, target, pick }) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const absolute = path.resolve(target || baseDirectory);
  const relative = path.relative(baseDirectory, absolute);
  let rows;
  if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
    const under = _.filter(
      _.map(excludedSongs(db), withFile(baseDirectory)),
      row => !relative || row.path === relative || row.path.startsWith(`${relative}/`)
    );
    if (under.length === 0) {
      logger.info(`No excluded songs under ${absolute}`);
      return [];
    }
    if (!pick) {
      logger.error('db --readmit needs a file, or a terminal to pick from the excluded songs');
      process.exitCode = 1;
      return [];
    }
    const picked = new Set(
      pick(
        _.map(under, row => `${row.path}\t${exclusionLine(row)}`),
        { prompt: 'readmit> ', header: 'Songs to let back into the library (tab picks several)' }
      )
    );
    rows = _.filter(under, row => picked.has(row.path));
  } else {
    const row = exclusionOf(db, relative);
    if (!row) {
      logger.error(`${relative} is not excluded from the library`);
      process.exitCode = 1;
      return [];
    }
    rows = [withFile(baseDirectory)(row)];
  }
  const readmitted = [];
  _.each(rows, row => {
    if (!row.inLibrary) {
      logger.warn(
        `${row.path} is in the trash: move it back first (musicman undo, or by hand), then readmit it`
      );
      return;
    }
    includeSong(db, row.path);
    // undo excludes it again, in favor of the copy kept then
    recordFileMove({
      action: 'include',
      file: path.join(baseDirectory, row.path),
      to: path.join(baseDirectory, row.kept || row.path)
    });
    readmitted.push(row);
  });
  if (readmitted.length > 0) {
    await updateDatabase(db, {
      config,
      files: _.map(readmitted, row => path.join(baseDirectory, row.path))
    });
    _.each(readmitted, row =>
      logger.info(`Readmitted ${row.path} (excluded ${row.day}: ${row.reason})`)
    );
  }
  return readmitted;
};

const formatSize = bytes => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

/**
 * db --restore: lists the database copies in db.backupDirectory; db --restore <name> replaces the library
 * database with one (restoreDatabase), after asking (--yes: without), never while another musicman run
 * is going (musicman ui included), which would write to the database being replaced.
 */
const restore = async ({ config, name, yes, confirm, running }) => {
  const copies = listRestorable(config.db.backupDirectory);
  if (!name) {
    if (copies.length === 0) {
      logger.info(`No database backups in ${config.db.backupDirectory}`);
      return { backups: [] };
    }
    logger.consoleLog(
      renderColumns({
        head: ['Backup', 'Made', 'Size', 'Schema'],
        rows: _.map(copies, copy => [
          copy.name,
          copy.at.toLocaleString(),
          formatSize(copy.size),
          copy.version === null
            ? 'unreadable'
            : `${copy.version}${copy.newer ? ' (newer than this musicman)' : ''}`
        ]),
        columns: [{}, {}, {}, {}]
      })
    );
    logger.info('musicman db --restore <name> restores one (the current database is saved first)');
    return { backups: _.map(copies, 'name') };
  }
  const copy = findRestorable(copies, name);
  if (!copy) {
    throw new Error(`No database backup '${name}' in ${config.db.backupDirectory}, see db --restore`);
  }
  const busy = running();
  if (busy.length > 0) {
    throw new Error(
      `${_.map(busy, run => `${run.command} (pid ${run.pid})`).join(', ')} is running: restore when it is done`
    );
  }
  const question =
    `Replace the library database with ${copy.name} (${copy.at.toLocaleString()})? ` +
    'Undo history recorded since is lost with it (the run reports stay).';
  if (!yes && !(await confirm(question))) {
    logger.info('Restore cancelled');
    return { restored: null };
  }
  const { saved } = restoreDatabase({ config, copy });
  if (saved) {
    logger.info(`Saved the database as it was to ${saved}`);
  }
  logger.info(
    `Restored ${copy.name}; files changed since it was made are not in it: run musicman db --update`
  );
  return { restored: copy.name, saved };
};

// db: show database stats; db --update [target]: update the database from mp3 files
const dbCommand = async ({
  target,
  options,
  config,
  pick = process.stdin.isTTY ? pickWithFzf : null,
  confirm = confirmPrompt,
  running = () => runningRuns(runsDirectory(config))
}) => {
  // before the database is opened: opening it migrates the database being replaced
  if (options.switches.restore) {
    try {
      return await restore({
        config,
        name: _.first(options.terms),
        yes: Boolean(options.switches.yes),
        confirm,
        running
      });
    } catch (err) {
      logger.error(err.message);
      process.exitCode = 1;
      return false;
    }
  }
  let db;
  try {
    db = openLibrary(config);
  } catch (err) {
    logger.error(`Fatal error: ${err.message}`);
    (err.details || []).forEach(detail => logger.error(`  - ${detail}`));
    process.exitCode = 1;
    return false;
  }

  try {
    if (options.switches.backup) {
      const backup = logBackup(backupDatabase(db, config));
      return { backup, stats: getStats(db, config.db.path) };
    }
    if (options.switches.excluded) {
      return { excluded: listExcluded(db, { config }) };
    }
    if (options.switches.readmit) {
      return { readmitted: await readmit(db, { config, target, pick }) };
    }
    if (options.switches.update) {
      const summary = await runUpdate(db, { config, target });
      return { summary, stats: getStats(db, config.db.path) };
    }
    const stats = getStats(db, config.db.path);
    outputDbStats(stats);
    return { stats };
  } finally {
    db.close();
  }
};

// without a target argument the whole library is updated
const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'db',
  description:
    'Show library database stats, update it from the files, back it up or restore a backup, or list and readmit excluded songs',
  usage:
    'musicman db [--update [target]] [--backup] [--excluded] [--readmit [path]] [--restore [name] [--yes]]',
  switches: ['update', 'backup', 'excluded', 'readmit', 'restore', 'yes'],
  completes: ['paths'],
  func: dbCommand,
  archive: ({ update, backup, readmit: readmitting }) => Boolean(update || backup || readmitting),
  defaultTarget
};
