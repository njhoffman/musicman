const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const migrations = require('./migrations.js');

// apply migrations newer than the stored schema version, each in its own transaction
const migrate = (db, steps = migrations) => {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version > steps.length) {
    throw new Error(
      `Database schema version ${version} is newer than this musicman supports (${steps.length})`
    );
  }
  steps.slice(version).forEach((sql, i) => {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
  return steps.length;
};

/**
 * Opens (creating if needed) the library database at dbPath and applies migrations.
 * WAL mode lets the notify daemon and the cli use the database at the same time.
 */
const openDatabase = dbPath => {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
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

module.exports = { getMeta, migrate, openDatabase, setMeta, transaction };
