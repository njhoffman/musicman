const _ = require('lodash');
const WebSocket = require('ws');
const http = require('http');

const config = require('@config');
const logger = require('./utils/logger');

const heartbeat = ws => {
  logger.debug(`♥ ${ws.ip}`);
  _.merge(ws, { isAlive: true });
};

const initWebSocket = app =>
  new Promise(resolve => {
    const server = http.createServer(app);

    // create the server
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws, req) => {
      const ip = req.connection.remoteAddress;
      logger.info(`WebSocket connected: ${ip}`);

      _.merge(ws, { isAlive: true, ip });

      ws.on('pong', () => heartbeat(ws));

      ws.on('message', message => {
        logger.info('websocket: received: %s', message);
        ws.send(`Hello, you sent -> ${message}`);
      });

      ws.send('Hi there, I am a WebSocket server');
    });

    const pingClients = () => {
      wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
          logger.info(`Stale connection with client ${ws.ip}`);
          return ws.terminate();
        }

        _.merge(ws, { isAlive: false });
        return ws.ping(() => {});
      });
    };
    setInterval(pingClients, 10000);

    const broadcast = (type, data) => {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          logger.debug(`${type}:`, data);
          client.send(JSON.stringify({ type, data }));
        }
      });
    };

    server.listen(config.websocket.port, () => {
      logger.info(`WebSocket server started on port ${config.websocket.port}`);
      resolve({ wss, broadcast });
    });
  });

module.exports = initWebSocket;
