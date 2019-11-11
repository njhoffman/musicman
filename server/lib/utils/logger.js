const _ = require('lodash');
const { inspect } = require('util');
const chalk = require('chalk');

const config = require('@config');

const padRight = (str, len) => (len > str.length ? str + new Array(len - str.length + 1).join(' ') : str);

/* eslint-disable no-console */
const levelMap = { trace: 6, debug: 5, info: 4, warn: 3, error: 2, fatal: 1 };

const outputMessage = (msg, i) => {
  if (_.isObject(msg)) {
    process.stdout.write(i > 0 ? '  ' : '');
    process.stdout.write(inspect(msg, { colors: true, breakLength: 120 }));
  } else if (msg.indexOf('\n') !== -1) {
    process.stdout.write(i > 0 ? '\n  ' : '');
    process.stdout.write(msg.split('\n').join('\n  '));
  } else {
    process.stdout.write(msg);
  }
};
/* eslint-enable no-console */

const log = (level, messages) => {
  const { level: loggerLevel } = config.logger.stdout;
  let label = _.findKey(levelMap, lmap => lmap === level);
  const color = config.logger.colors[label];
  label = chalk.bold(` ${padRight(label.toUpperCase(), 6)}`);
  label = color.fg ? chalk.rgb(...color.fg)(label) : label;
  label = color.bg ? chalk.bgRgb(...color.bg)(label) : label;

  if (loggerLevel >= level) {
    process.stdout.write(`${label}  `);
    messages.filter(Boolean).forEach(outputMessage);
    process.stdout.write('\n');
  }
};

const logger = _.mapValues(levelMap, level => (...messages) => log(level, messages));

module.exports = logger;
