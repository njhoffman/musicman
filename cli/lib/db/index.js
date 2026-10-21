const { getMeta, openDatabase, setMeta } = require('./database.js');
const { syncTagDefinitions } = require('./tags.js');
const { updateDatabase } = require('./update.js');
const { readStoredMetadata } = require('./read.js');
const { autoBackup: autoBackupWith, backupDatabase, backupIfDue } = require('./backup.js');

/**
 * Opens the library database from config.db.path and stores tag definitions.
 * Throws if a stored custom field definition changed, with each problem in err.details.
 */
const openLibrary = (config, dbPath = config.db.path) => {
  const db = openDatabase(dbPath);
  const { errors } = syncTagDefinitions(db, config);
  if (errors.length > 0) {
    db.close();
    const err = new Error(`Custom field definitions changed in ${dbPath}`);
    err.details = errors;
    throw err;
  }
  return db;
};

module.exports = {
  backupDatabase,
  autoBackup: (config, options) => autoBackupWith(config, { open: openLibrary, ...options }),
  backupIfDue,
  getMeta,
  openLibrary,
  readStoredMetadata,
  setMeta,
  updateDatabase
};
