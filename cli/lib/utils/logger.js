const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const { inspect } = require('util');
const chalk = require('chalk').default;

const { defaultConfig } = require('musicman-common/config');
const { logLevels } = require('musicman-common/config/validator');

// position of a level name in logLevels (error, warn, info, debug, trace), higher is more detailed
const levelIndex = name => logLevels.indexOf(name);

// log files written by log messages: the appended main log (configureLogFile) and the log of the
// current run (configureRunLog)
const logFiles = { main: null, run: null };

// level badge colors (logger.colors), defaults until configureColors is called with the loaded config
let colors = _.get(defaultConfig, 'logger.colors', {});

// output settings start from the defaults until configure is called with the loaded config
let settings = _.pick(defaultConfig.output, ['padding', 'verbosity']);

// terminal columns left after the left padding added by consoleLog, unlimited when not a terminal
const availableWidth = () => (process.stdout.columns || Infinity) - settings.padding;

// eslint-disable-next-line no-control-regex
const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '');

// status line kept as a footer below log output, null when there is none
let footer = null;

// text cut to width visible characters, keeping its colors and resetting them at the cut
const truncateAnsi = (text, width) => {
  // eslint-disable-next-line no-control-regex
  const escape = /\u001b\[[0-9;]*m/y;
  let visible = 0;
  let output = '';
  for (let i = 0; i < text.length;) {
    escape.lastIndex = i;
    const match = escape.exec(text);
    if (match) {
      output += match[0];
      i += match[0].length;
    } else if (visible < width) {
      output += text[i];
      visible += 1;
      i += 1;
    } else {
      break;
    }
  }
  return `${output}\u001b[0m`;
};

// footer cut to the terminal width, a wrapped footer could not be redrawn in place
const fitFooter = message => {
  const columns = process.stderr.columns || Infinity;
  if (stripAnsi(message).length < columns) {
    return message;
  }
  return truncateAnsi(message, columns - 1);
};

const drawFooter = () => {
  if (footer !== null) {
    process.stderr.write(`\r\x1b[K${fitFooter(footer)}`);
  }
};

const clearFooter = () => {
  if (footer !== null) {
    process.stderr.write('\r\x1b[K');
  }
};

// single updating status line on stderr, only shown when stderr is a terminal; log messages are
// printed above it so it stays on the last line
const progress = message => {
  if (process.stderr.isTTY) {
    footer = message;
    drawFooter();
  }
};

const progressDone = () => {
  if (process.stderr.isTTY) {
    process.stderr.write('\r\x1b[K');
  }
  footer = null;
};

// stream is stdout, or stderr when stdout carries data (--format csv, json, ...)
const configure = output => {
  settings = { ...settings, ..._.pick(output, ['padding', 'verbosity', 'stream']) };
};

const openLogFile = (slot, { name, level = 'debug' } = {}) => {
  if (logFiles[slot]) {
    fs.closeSync(logFiles[slot].fd);
    logFiles[slot] = null;
  }
  if (name) {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    logFiles[slot] = { fd: fs.openSync(name, 'a'), level: levelIndex(level) };
  }
};

/**
 * Appends log messages up to level (a logLevels name) to file, without colors and with a timestamp and
 * level. Called with no file to stop writing.
 */
const configureLogFile = options => openLogFile('main', options);

// same as configureLogFile for the log archived with the current run, written alongside the main log
const configureRunLog = options => openLogFile('run', options);

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
    clearFooter();
    if (settings.stream === 'stderr') {
      console.error(parsed);
    } else {
      console.log(parsed);
    }
    drawFooter();
  }
  return parsed;
};
/* eslint-enable no-console */

const writeLogFile = (logLevel, message) => {
  const files = _.filter(_.values(logFiles), file => file && logLevel <= file.level);
  if (files.length === 0) {
    return;
  }
  const text = _.isString(message)
    ? message
    : inspect(message, { compact: true, breakLength: Infinity });
  const line = `${new Date().toISOString()} ${logLevels[logLevel]
    .toUpperCase()
    .padEnd(5)} ${stripAnsi(text)}\n`;
  files.forEach(file => fs.writeSync(file.fd, line));
};

// log file only, for detail that would flood the terminal (e.g. every file of a library update)
const logToFile = (levelName, message) => writeLogFile(levelIndex(levelName), message);

const configureColors = levelColors => {
  colors = levelColors || {};
};

// level name colored with the level's fg, bg, and gui from logger.colors, padded after the color so
// messages of every level start in the same column
const badge = levelName => {
  const { fg, bg, gui } = colors[levelName] || {};
  let style = chalk;
  if (fg) {
    style = style.hex(fg);
  }
  if (bg) {
    style = style.bgHex(bg);
  }
  if (['bold', 'italic', 'underline'].includes(gui)) {
    style = style[gui];
  }
  return `${style(` ${levelName.toUpperCase()} `)}${' '.repeat(5 - levelName.length)}`;
};

// badge before the first line of text, after any leading blank lines
const withBadge = (levelName, message) => {
  const text = _.isString(message) ? message : inspect(message, inspectOptions());
  const [, leading, rest] = text.match(/^(\n*)([\s\S]*)$/);
  return `${leading}${badge(levelName)} ${rest}`;
};

const log = (logLevel, message) => {
  writeLogFile(logLevel, message);
  if (levelIndex(settings.verbosity) >= logLevel) {
    return consoleLog(withBadge(logLevels[logLevel], message));
  }
  return message;
};

const logger = _.fromPairs(logLevels.map(name => [name, log.bind(null, levelIndex(name))]));

module.exports = {
  availableWidth,
  configure,
  configureColors,
  configureLogFile,
  configureRunLog,
  logToFile,
  stripAnsi,
  truncateAnsi,
  consoleLog,
  progress,
  progressDone,
  ...logger
};
