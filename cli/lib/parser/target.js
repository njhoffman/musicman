const _ = require('lodash');
const chalk = require('chalk');
const path = require('path');
const termSize = require('term-size');

const { checkExists } = require('../utils/files');
const logger = require('../utils/logger');

const { columns } = termSize();

const getTarget = ({ args, currentSong, baseDirectory }) => {
  const argTarget = _.find(args, arg => {
    return checkExists(arg) ? arg : false;
  });

  // return target if exists, resolved to absolute path
  if (argTarget) {
    return path.resolve(argTarget);
  }

  // if song playing, assume that is the target, otherwise it is the current directory
  if (currentSong) {
    const target = path.join(baseDirectory, currentSong.file);
    const msgOut = `Using currently playing song:  ${chalk.blue(
      target
        .split('/')
        .pop()
        .slice(0, columns - 21)
    )}`;
    logger.info(msgOut);
    return target;
  }
  return process.cwd();
};

module.exports = getTarget;
