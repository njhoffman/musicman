const fs = require('fs');

const { backupDatabase, getMeta, openLibrary, updateDatabase } = require('../db/index.js');
const { formatProgress, outputDbStats, outputUpdateSummary } = require('../output/db.js');
const logger = require('../utils/logger.js');

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

// db: show database stats; db --update [target]: update the database from mp3 files
const dbCommand = async ({ target, options, config }) => {
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
  description: 'Show library database stats, update it from the files, or back it up',
  usage: 'musicman db [--update [target]] [--backup]',
  switches: ['update', 'backup'],
  completes: ['paths'],
  func: dbCommand,
  archive: ({ update, backup }) => update || backup,
  defaultTarget
};
