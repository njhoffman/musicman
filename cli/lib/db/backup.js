const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const { parseInterval } = require('musicman-common/config/validator');

const { getMeta, setMeta } = require('./database.js');

const backupPattern = /^musicman-\d{8}-\d{6}\.sqlite$/;

const timestamp = date =>
  date
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');

// backup files in the directory, oldest first (the timestamped names sort by time)
const listBackups = directory =>
  fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter(file => backupPattern.test(file))
        .sort()
    : [];

/**
 * Writes a consistent copy of the database to db.backupDirectory with VACUUM INTO and deletes the
 * oldest backups beyond db.backupCount. Returns the backup record stored as meta lastBackup.
 */
const backupDatabase = (db, config, now = new Date()) => {
  const { backupDirectory, backupCount = 7 } = config.db;
  fs.mkdirSync(backupDirectory, { recursive: true });
  const file = path.join(backupDirectory, `musicman-${timestamp(now)}.sqlite`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  db.prepare('VACUUM INTO ?').run(file);

  const removed = _.dropRight(listBackups(backupDirectory), backupCount);
  removed.forEach(old => fs.unlinkSync(path.join(backupDirectory, old)));

  const backup = {
    at: now.toISOString(),
    file,
    size: fs.statSync(file).size,
    removed: removed.length
  };
  setMeta(db, 'lastBackup', backup);
  return backup;
};

/**
 * Backs up the database when db.backupInterval has passed since the last backup (or there is none).
 * Returns the backup record, or null when no backup was due.
 */
const backupIfDue = (db, config, now = new Date()) => {
  const interval = parseInterval(_.get(config, 'db.backupInterval', '1 day'));
  const lastBackup = getMeta(db, 'lastBackup');
  const { songs } = db.prepare('SELECT COUNT(*) AS songs FROM songs').get();
  // nothing worth backing up yet, or the last backup is recent enough
  if (songs === 0 || (lastBackup && now - new Date(lastBackup.at) < interval)) {
    return null;
  }
  return backupDatabase(db, config, now);
};

module.exports = { backupDatabase, backupIfDue, listBackups };
