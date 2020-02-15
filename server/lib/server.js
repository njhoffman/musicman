const express = require('express');

const config = require('../config');
const { MpdClient } = require('../../common/mpd/MpdClient');
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
  const mpdClient = MpdClient.connect({ port: config.mpd.port, host: config.mpd.host });
  const { wss, broadcast } = await initWebsocket(app);

  await initRouter({ app, wss, broadcast, mpdClient });
  await startServer(app);
  return app;
};

module.exports = initServer;
