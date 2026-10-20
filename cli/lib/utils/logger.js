const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const { inspect } = require('util');
const termSize = require('term-size').default;

const { defaultConfig } = require('musicman-common/config');

// log file written by log messages, set by configureLogFile
let logFile = null;

// output settings start from the defaults until configure is called with the loaded config
let settings = _.pick(defaultConfig.output, ['padding', 'verbosity']);

// terminal columns left after the left padding added by consoleLog, unlimited when not a terminal
const availableWidth = () => (process.stdout.columns || Infinity) - settings.padding;

// single updating status line on stderr, only shown when stderr is a terminal
const progress = message => {
  if (process.stderr.isTTY) {
    process.stderr.write(`\r\x1b[K${message}`);
  }
};

const progressDone = () => {
  if (process.stderr.isTTY) {
    process.stderr.write('\r\x1b[K');
  }
};

const configure = output => {
  settings = { ...settings, ..._.pick(output, ['padding', 'verbosity']) };
};

/**
 * Appends log messages at or below level (config scale, 5 = debug) to file, without colors and with a
 * timestamp and level. Called with no file to stop writing.
 */
const configureLogFile = ({ name, level = 5 } = {}) => {
  if (logFile) {
    fs.closeSync(logFile.fd);
    logFile = null;
  }
  if (name) {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    logFile = { fd: fs.openSync(name, 'a'), level };
  }
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

// log file levels use the config scale: 2 error, 3 warn, 4 info, 5 debug, 6 trace
const levelNames = ['error', 'warn', 'info', 'debug', 'trace'];

// eslint-disable-next-line no-control-regex
const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '');

const writeLogFile = (logLevel, message) => {
  if (!logFile || logLevel + 2 > logFile.level) {
    return;
  }
  const text = _.isString(message)
    ? message
    : inspect(message, { compact: true, breakLength: Infinity });
  const line = `${new Date().toISOString()} ${levelNames[logLevel]
    .toUpperCase()
    .padEnd(5)} ${stripAnsi(text)}\n`;
  fs.writeSync(logFile.fd, line);
};

// log file only, for detail that would flood the terminal (e.g. every file of a library update)
const logToFile = (levelName, message) => writeLogFile(levelNames.indexOf(levelName), message);

const log = (logLevel, message) => {
  writeLogFile(logLevel, message);
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
  availableWidth,
  configure,
  configureLogFile,
  logToFile,
  consoleLog,
  progress,
  progressDone,
  ...logger
};
