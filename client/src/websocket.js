import { isJson } from './utils';
import { createLogger, prettyJson } from './utils/logger';

const address = 'ws://127.0.0.1:8999';
const logger = createLogger('websocket');

const initializeWebSocket = () => {
  logger.debug(`Connecting to websocket: ${address}`);
  const client = new WebSocket(address);

  client.onopen = () => {
    logger.info(`WebSocket connected to ${address}`);
  };

  client.onmessage = message => {
    const { data, origin } = message;
    if (isJson(data)) {
      const parsedData = JSON.parse(data);
      if (parsedData.type) {
        logger.debug(`${parsedData.type}`);
        prettyJson(parsedData.data);
      } else {
        logger.debug(`WebSocket message from ${origin}`);
        prettyJson(parsedData);
      }
    } else {
      logger.debug(`WebSocket message:`, data);
    }
  };

  client.onclose = () => {
    logger.warn('WebSocket closed');
  };
};

export default initializeWebSocket;
