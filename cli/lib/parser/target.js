const _ = require('lodash');
const chalk = require('chalk').default;
const path = require('path');
const termSize = require('term-size').default;

const { checkExists } = require('../utils/files.js');
const logger = require('../utils/logger.js');

const { columns } = termSize();

const getTarget = ({ args, currentSong, baseDirectory, command }) => {
  const argTarget = _.find(args, arg => {
    return checkExists(arg) ? arg : false;
  });

  // return target if exists, resolved to absolute path
  if (argTarget) {
    return path.resolve(argTarget);
  }

  // if song playing and is a view/edit command, set song path as target
  if (currentSong && /edit|view/.test(command.name)) {
    const target = path.join(baseDirectory, currentSong.file);

    const msgOut = `Using currently playing song:  ${chalk.blue(
      target
        .split('/')
        .pop()
        .slice(0, columns - 21)
    )}`;
    logger.info(msgOut);
    logger.debug(`mid3v2 "${target}"`);

    return target;
  }
  // commands like db default to a target of their own, e.g. the whole library
  if (command.defaultTarget) {
    return command.defaultTarget(baseDirectory);
  }

  // otherwise it is the current directory if not an edit command
  // (want to explicitly demand target argument for editing multiple files)
  return command.name !== 'edit' ? process.cwd() : false;
};

module.exports = getTarget;
