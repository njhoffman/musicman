const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const { inspect } = require('util');

const { defaultConfig } = require('musicman-common/config');
const { logLevels } = require('musicman-common/config/validator');

// position of a level name in logLevels (error, warn, info, debug, trace), higher is more detailed
const levelIndex = name => logLevels.indexOf(name);

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
 * Appends log messages up to level (a logLevels name) to file, without colors and with a timestamp and
 * level. Called with no file to stop writing.
 */
const configureLogFile = ({ name, level = 'debug' } = {}) => {
  if (logFile) {
    fs.closeSync(logFile.fd);
    logFile = null;
  }
  if (name) {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    logFile = { fd: fs.openSync(name, 'a'), level: levelIndex(level) };
  }
};

// objects are wrapped at the terminal width, or 80 columns when not a terminal
const inspectOptions = () => ({
  colors: true,
  compact: false,
  breakLength: process.stdout.columns || 80
});

/* eslint-disable no-console */
const consoleLog = message => {
  const { NODE_ENV, NODE_TEST_LOG } = process.env;
  const { padding } = settings;

  const leftPadding = Array(padding + 1).join(' ');
  let parsed = message;
  if (_.isObject(message)) {
    parsed = inspect(message, inspectOptions());
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

// eslint-disable-next-line no-control-regex
const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '');

const writeLogFile = (logLevel, message) => {
  if (!logFile || logLevel > logFile.level) {
    return;
  }
  const text = _.isString(message)
    ? message
    : inspect(message, { compact: true, breakLength: Infinity });
  const line = `${new Date().toISOString()} ${logLevels[logLevel]
    .toUpperCase()
    .padEnd(5)} ${stripAnsi(text)}\n`;
  fs.writeSync(logFile.fd, line);
};

// log file only, for detail that would flood the terminal (e.g. every file of a library update)
const logToFile = (levelName, message) => writeLogFile(levelIndex(levelName), message);

const log = (logLevel, message) => {
  writeLogFile(logLevel, message);
  if (levelIndex(settings.verbosity) >= logLevel) {
    return consoleLog(message);
  }
  return message;
};

const logger = _.fromPairs(logLevels.map(name => [name, log.bind(null, levelIndex(name))]));

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
