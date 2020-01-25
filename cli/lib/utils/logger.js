const _ = require('lodash');
const { inspect } = require('util');

/* eslint-disable no-console */
const consoleLog = message => {
  const { NODE_ENV, NODE_TEST_LOG } = process.env;
  let parsed = message;
  if (_.isObject(message)) {
    parsed = inspect(message, { colors: true, compact: false })
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n');
  }
  if (NODE_ENV !== 'test' && !NODE_TEST_LOG) {
    console.log(parsed);
  }
  return parsed;
};
/* eslint-enable no-console */

const log = (logLevel, message) => {
  return consoleLog(message);
};

const logger = {
  error: log.bind(null, 0),
  warn: log.bind(null, 1),
  info: log.bind(null, 2),
  debug: log.bind(null, 3),
  trace: log.bind(null, 4)
};

module.exports = {
  consoleLog,
  ...logger
};
