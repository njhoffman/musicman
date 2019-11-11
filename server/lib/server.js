const express = require('express');

const config = require('@config');
const initWebsocket = require('./websocket');
const initRouter = require('./router');
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
  await initWebsocket(app);
  return app;
};

module.exports = initServer;
