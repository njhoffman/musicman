const _ = require('lodash');
const chalk = require('chalk');
const path = require('path');
const termSize = require('term-size');

const logger = require('../utils/logger');

const { columns } = termSize();

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
  }
  // return target if exists, resolved to absolute path
  return path.resolve(argTarget);
};

module.exports = getTarget;
