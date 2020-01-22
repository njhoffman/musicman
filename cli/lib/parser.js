const _ = require('lodash');
const path = require('path');
const chalk = require('chalk');
const termSize = require('term-size');

const { getOptions } = require('./parser/options');
const logger = require('./utils/logger');
const commands = require('./commands');

const { columns } = termSize();

const getCommand = args => {
  const command = (args[0] || '').trim();
  const viewCommand = _.find(commands, { name: 'view' });
  if (!command) {
    return viewCommand;
  }
  if (/^\d+(?:\.\d+)?$/.test(command)) {
    // if first argument is numeric, it is a rating (edit command)
    return _.find(commands, { name: 'edit' });
  } else if (/^\w+=.*/.test(command)) {
    // if first argument includes assignment operator (=), it is an edit
    return _.find(commands, { name: 'edit' });
  }
  return _.find(commands, { name: command }) || viewCommand;
};

const getTarget = ({ args, currentSong, baseDirectory, utils }) => {
  const {
    file: { checkExists }
  } = utils;

  const argTarget = _.find(args, arg => {
    return checkExists(arg) ? arg : false;
  });

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

const parser = ({ args, currentSong, config, utils }) => {
  const { baseDirectory } = config.mpd;
  const target = getTarget({ args, currentSong, baseDirectory, utils });
  const command = getCommand(args);

  const remainingArgs = args.filter(arg => arg !== target && arg !== command);
  const options = getOptions(remainingArgs, config);
  return { target, command, options };
};

module.exports = parser;
