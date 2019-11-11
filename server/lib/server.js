const express = require('express');

const config = require('@config');
const initRouter = require('./router');
const { exceptionHandler, rejectionHandler } = require('./utils/errors');
const logger = require('./utils/logger');

const startServer = async app => {
  if (config.env !== 'test') {
    await app.listen(config.server.port);
    logger.info(`API is running on port: ${config.server.port}`);
  }
  return app;
};

const initServer = async () => {
  const app = express();
  await initRouter(app);
  await startServer(app);

  return app;
};

process.on('uncaughtException', exceptionHandler);
process.on('unhandledRejection', rejectionHandler);

// prevent program from closing instantly
process.stdin.resume();
process.on('exit', (code) => {
  logger.warn('*** EXIT', code);
  process.exit(code);
});

// async flush logs
process.on('SIGINT', () => {
  logger.warn('*** SIGINT');
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

process.on('SIGHUP', () => {
  logger.warn('*** SIGHUP');
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  logger.warn('*** SIGTERM');
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

module.exports = initServer;
