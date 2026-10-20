const _ = require('lodash');
const { inspect } = require('util');
const termSize = require('term-size').default;

const { defaultConfig } = require('musicman-common/config');

// output settings start from the defaults until configure is called with the loaded config
let settings = _.pick(defaultConfig.output, ['padding', 'verbosity']);

const configure = output => {
  settings = { ...settings, ..._.pick(output, ['padding', 'verbosity']) };
};

const inspectOptions = { colors: true, compact: false, breakLength: termSize().columns };

/* eslint-disable no-console */
const consoleLog = message => {
  const { NODE_ENV, NODE_TEST_LOG } = process.env;
  const { padding } = settings;

  const leftPadding = Array(padding + 1).join(' ');
  let parsed = message;
  if (_.isObject(message)) {
    parsed = inspect(message, inspectOptions);
  } else if (parsed.includes('\n')) {
    parsed = parsed
      .split('\n')
      .map(line => `${leftPadding}${line}`)
      .join('\n');
  } else {
    parsed = `${leftPadding}${parsed}`;
  }

  if (NODE_ENV !== 'test' && !NODE_TEST_LOG) {
    console.log(parsed);
  }
  return parsed;
};
/* eslint-enable no-console */

const log = (logLevel, message) => {
  const { verbosity } = settings;
  if (verbosity >= logLevel) {
    return consoleLog(message);
  }
  return message;
};

const logger = {
  error: log.bind(null, 0),
  warn: log.bind(null, 1),
  info: log.bind(null, 2),
  debug: log.bind(null, 3),
  trace: log.bind(null, 4)
};

module.exports = {
  configure,
  consoleLog,
  ...logger
};
