const { Pool } = require('pg');
const logger = require('./utils/logger');
const dbOperations = require('./db/operations');

let pool;

const dbFunc = {
  close: () => pool.end(),
  query: (text, params) => pool.query(text, params),
  write: async (insertText, insertValues) => {
    try {
      await pool.query('BEGIN');
      await pool.query(insertText, insertValues);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    } finally {
      await pool.end();
    }
  }
};

module.exports = async dbConfig => {
  logger.info(`Connecting to database: "${dbConfig.database}" on ${dbConfig.host}`);
  pool = await new Pool(dbConfig);

  return dbOperations(dbFunc);
};
