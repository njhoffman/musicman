const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const migrations = require('./migrations.js');

// the database copies in db.backupDirectory: automatic ones (musicman-<time>.sqlite) and named ones
// (musicman-before-rebuild-20261020.sqlite)
const restorablePattern = /^musicman-.+\.sqlite$/;

const stamp = now => now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

// the schema version of a database file, read without migrating it; null when it cannot be read
const schemaVersion = file => {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return db.prepare('PRAGMA user_version').get().user_version;
  } catch {
    return null;
  } finally {
    if (db) {
      db.close();
    }
  }
};

/**
 * The database copies that can be restored, newest first: { name, file, at (modified), size, version
 * (schema), newer (a schema this musicman cannot open) }.
 */
const listRestorable = directory =>
  fs.existsSync(directory)
    ? _.orderBy(
        _.map(
          fs.readdirSync(directory).filter(name => restorablePattern.test(name)),
          name => {
            const file = path.join(directory, name);
            const { mtime, size } = fs.statSync(file);
            const version = schemaVersion(file);
            return {
              name,
              file,
              at: mtime,
              size,
              version,
              newer: version !== null && version > migrations.length
            };
          }
        ),
        ['at'],
        ['desc']
      )
    : [];

// the copy a name picks: its file name, the name without .sqlite, or a part only it has
const findRestorable = (copies, name) => {
  const exact = _.find(copies, copy => copy.name === name || copy.name === `${name}.sqlite`);
  if (exact) {
    return exact;
  }
  const matches = _.filter(copies, copy => copy.name.includes(name));
  if (matches.length > 1) {
    throw new Error(
      `'${name}' matches ${matches.length} backups: ${_.map(matches, 'name').join(', ')}`
    );
  }
  return matches[0] || null;
};

/**
 * Replaces the library database with a copy: the current database is saved first as
 * musicman-before-restore-<time>.sqlite next to the backups (so a restore can be undone the same way),
 * then the copy goes into place through a temporary file, and the old -wal and -shm files are removed
 * so they never mix with the restored database. The databases are opened directly, not through
 * openDatabase, which would migrate them. Returns { restored, saved }.
 */
const restoreDatabase = ({ config, copy, now = new Date() }) => {
  const dbPath = config.db.path;
  if (copy.version === null) {
    throw new Error(`${copy.name} is not a database musicman can read`);
  }
  if (copy.newer) {
    throw new Error(
      `${copy.name} has schema version ${copy.version}, newer than this musicman supports (${migrations.length})`
    );
  }
  let saved = null;
  if (fs.existsSync(dbPath)) {
    saved = path.join(config.db.backupDirectory, `musicman-before-restore-${stamp(now)}.sqlite`);
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    const current = new DatabaseSync(dbPath);
    try {
      current.prepare('VACUUM INTO ?').run(saved);
    } finally {
      current.close();
    }
  }
  const temporary = `${dbPath}.musicman-restore`;
  fs.copyFileSync(copy.file, temporary);
  ['-wal', '-shm'].forEach(suffix => fs.rmSync(`${dbPath}${suffix}`, { force: true }));
  fs.renameSync(temporary, dbPath);
  return { restored: copy, saved };
};

module.exports = { findRestorable, listRestorable, restoreDatabase, schemaVersion };
