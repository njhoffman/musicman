const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const migrations = require('./migrations.js');
const logger = require('../utils/logger.js');

const schemaOf = db => db.prepare('PRAGMA user_version').get().user_version;

// a time for file names: 20261103-153127 (UTC)
const stamp = date => date.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/**
 * Applies the migrations newer than the stored schema version, each in its own transaction. before(version,
 * target) runs first when any are pending. Each step takes the write lock and reads the version again, so
 * of two processes migrating at once, the second skips what the first applied while it waited.
 */
const migrate = (db, steps = migrations, { before = () => {} } = {}) => {
  const version = schemaOf(db);
  if (version > steps.length) {
    throw new Error(
      `Database schema version ${version} is newer than this musicman supports (${steps.length})`
    );
  }
  if (version < steps.length) {
    before(version, steps.length);
  }
  steps.slice(version).forEach((sql, i) => {
    const step = version + i;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (schemaOf(db) === step) {
        db.exec(sql);
        db.exec(`PRAGMA user_version = ${step + 1}`);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
  return steps.length;
};

/**
 * Copies a database about to be migrated to <directory>/musicman-before-schema-<target>.sqlite (kept, not
 * counted in db.backupCount), since the backups on db.backupInterval can skip right over a migration. A copy
 * of that name stays: the new one gets the time as well, as when a restored database is migrated again.
 * A new database has nothing to save. Throws when the copy cannot be written, so nothing is migrated without it.
 */
const copyBeforeMigrating = (db, { directory, version, target, now = new Date() }) => {
  if (version === 0) {
    return null;
  }
  const name = `musicman-before-schema-${target}`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    const plain = path.join(directory, `${name}.sqlite`);
    const file = fs.existsSync(plain)
      ? path.join(directory, `${name}-${stamp(now)}.sqlite`)
      : plain;
    db.prepare('VACUUM INTO ?').run(file);
    logger.info(`Migrating the database from schema ${version} to ${target}, saved it to ${file}`);
    return file;
  } catch (err) {
    throw new Error(
      `Database not migrated to schema ${target}: could not save a copy to ${directory} first (${err.message})`,
      { cause: err }
    );
  }
};

/**
 * Opens (creating if needed) the library database at dbPath and applies migrations, after saving a copy to
 * backupDirectory (db.backupDirectory; .musicman next to the database without it).
 * WAL mode lets the notify daemon and the cli use the database at the same time.
 */
const openDatabase = (dbPath, { backupDirectory } = {}) => {
  const inMemory = dbPath === ':memory:';
  if (!inMemory) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db, migrations, {
      before: (version, target) =>
        inMemory ||
        copyBeforeMigrating(db, {
          directory: backupDirectory || path.join(path.dirname(dbPath), '.musicman'),
          version,
          target
        })
    });
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
};

// runs fn inside a transaction, rolling back if it throws
const transaction = (db, fn) => {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

const getMeta = (db, key) => {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
};

const setMeta = (db, key, value) =>
  db
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    )
    .run(key, JSON.stringify(value));

module.exports = { getMeta, migrate, openDatabase, setMeta, stamp, transaction };
