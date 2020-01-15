const _ = require('lodash');
const { inspect } = require('util');

/* eslint-disable no-console */
const log = (errorLevel, message) => {
  let parsed = message;
  if (_.isObject(message)) {
    parsed = inspect(message, { colors: true, compact: false })
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n');
  }

  if (process.env.NODE_ENV !== 'test') {
    console.log(parsed);
  }
  return parsed;
};
/* eslint-enable no-console */

module.exports = {
  error: log.bind(null, 0),
  warn: log.bind(null, 1),
  info: log.bind(null, 2),
  debug: log.bind(null, 3),
  trace: log.bind(null, 4)
};
