import { isJson } from './utils';
import { createLogger, prettyJson } from './utils/logger';

const address = 'ws://127.0.0.1:8999';
const logger = createLogger('websocket');

logger.debug(`Connecting to websocket: ${address}`);
const client = new WebSocket(address);

const initializeWebSocket = ({ setValue }) => {
  client.onopen = () => {
    logger.info(`WebSocket connected to ${address}`);
  };

  client.onmessage = message => {
    const { data, origin } = message;

    if (isJson(data)) {
      const parsedData = JSON.parse(data);
      if (parsedData.type) {
        if (parsedData.type === 'MPD_STATUS') {
          setValue(state => {
            return { ...state, time: parsedData.data.time[1] };
          });
        }

        if (parsedData.type === 'MPD_CURRENT_SONG') {
          setValue(state => {
            return { ...state, artist: parsedData.data.Artist[0], title: parsedData.data.Title[0] };
          });
        }

        if (parsedData.type === 'MPD_STATS') {
          logger.trace(`${parsedData.type}`);
        } else {
          logger.debug(`${parsedData.type}`);
          prettyJson(parsedData.data);
        }
      } else {
        logger.debug(`WebSocket message from ${origin}`);
        // prettyJson(parsedData);
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
