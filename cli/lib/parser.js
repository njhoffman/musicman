const _ = require('lodash');
const path = require('path');
const chalk = require('chalk');
const termSize = require('term-size');

const logger = require('./utils/logger');
const commands = require('./commands');
const { checkExists } = require('./utils');

const { columns } = termSize();

const getCommand = args => {
  const command = (args[0] || '').trim();
  if (!command) {
    return _.find(commands, { name: 'view' });
  }
  if (/^\d+(?:\.\d+)?$/.test(command)) {
    return _.find(commands, { name: 'edit' });
  }
  return _.find(commands, { name: command }) || { name: 'view' };
};

const getTarget = (args, currentSong, baseDirectory) => {
  const argTarget = checkExists(_.last(args));
  // potential target as last argument
  if (!argTarget) {
    if (currentSong) {
      const target = path.join(baseDirectory, currentSong.file);
      const msgOut = `Using current song:  ${chalk.blue(
        target
          .split('/')
          .pop()
          .slice(0, columns - 21)
      )}`;
      logger.info(msgOut);
      return target;
    }
    return process.cwd();
  }
  return argTarget;
};

const usage = args => {
  console.log(args);
};

const parser = ({ args, currentSong, config }) => {
  const target = getTarget(args, currentSong, config.mpd.baseDirectory);
  const command = getCommand(args);
  const options = args.filter(arg => arg !== target && arg !== command);
  return { target, command, options };
};

module.exports = parser;