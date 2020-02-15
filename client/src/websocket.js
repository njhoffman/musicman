import _ from 'lodash';

import { isJson } from './utils';
import { createLogger, prettyJson } from './utils/logger';

const address = 'ws://127.0.0.1:8999';
const logger = createLogger('websocket');

logger.debug(`Connecting to websocket: ${address}`);
const client = new WebSocket(address);

const mpdStatus = data => {
  if (_.keys(data).length === 1 && _.has(data, 'time')) {
    logger.debug(`MPD_STATUS: time +${data.time[0] - data.time[1]}s`);
  } else {
    logger.debug('MPD_STATUS');
    prettyJson(data);
  }
  return {
    time: _.get(data, 'time[1]'),
    state: _.get(data, 'state'),
  };
};

const mpdCurrentSong = data => {
  // Last-Modified
  logger.debug('MPD_CURRENT_SONG');
  prettyJson(data);
  return {
    artist: _.get(data, 'Artist[0]'),
    title: _.get(data, 'Title[0]'),
  };
};

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
          const newData = mpdStatus(parsedData.data);
          setValue(state => _.defaults(newData, state));
        } else if (parsedData.type === 'MPD_CURRENT_SONG') {
          const newData = mpdCurrentSong(parsedData.data);
          setValue(state => _.defaults(newData, state));
        } else if (parsedData.type === 'MPD_STATS') {
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
