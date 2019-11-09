const express = require('express');
const router = require('express-promise-router')();

const { exceptionHandler, rejectionHandler } = require('./utils/errors');
const config = require('../config');

const startServer = async app => {
  if (config.env !== 'test') {
    await app.listen(config.server.port);
    console.log(`API is running on port: ${config.server.port}`);
  }
  return app;
};

const initRouter = (app) => {
  router.get('/version', (req, res) => {
    res.send({ version: config.version });
  });

  router.get('/scan', (req, res) => {
    res.send('OK');
  });

  app.use(router);
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

// async flush logs
process.on('SIGINT', () => process.exit(0));

module.exports = initServer;
