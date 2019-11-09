const { exceptionHandler, rejectionHandler } = require('./utils/errors');
const config = require('../config');

const initServer = async () => {
  console.log(`Initializing Server on port ${config.server.port}...`);
};

process.on('uncaughtException', exceptionHandler);
process.on('unhandledRejection', rejectionHandler);

// async flush logs
process.on('SIGINT', () => process.exit(0));

module.exports = initServer;
