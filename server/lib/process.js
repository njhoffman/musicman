const logger = require('./utils/logger');
const { exceptionHandler, rejectionHandler } = require('./utils/errors');

process.on('uncaughtException', exceptionHandler);
process.on('unhandledRejection', rejectionHandler);

// prevent program from closing instantly
process.stdin.resume();
process.on('exit', code => {
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
