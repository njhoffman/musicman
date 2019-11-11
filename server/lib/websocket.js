const WebSocket = require('ws');
const http = require('http');

const config = require('@config');
const logger = require('./utils/logger');

const initWebsocket = app => {
  const server = http.createServer(app);

  // create the server
  const wsServer = new WebSocket.Server({ server });

  wsServer.on('connection', ws => {
    ws.on('message', message => {
      logger.info('websocket: received: %s', message);
      ws.send(`Hello, you sent -> ${message}`);
    });

    ws.send('Hi there, I am a WebSocket server');
  });

  server.listen(config.websocket.port, () => {
    logger.info(`WebSocket server started on port ${config.websocket.port}`);
  });
};

module.exports = initWebsocket;
