const commandParser = require('./parser');
const mpdConnect = require('./mpd');
const config = require('../config');
const initUtils = require('./utils');
const logger = require('./utils/logger');

const usage = args => {
  logger.info('USAGE', args);
};

const run = async args => {
  const currentSong = await mpdConnect(config.mpd);
  const utils = initUtils(config);

  const { command, target, options } = commandParser({ args, currentSong, config, utils });

  if (!target) {
    logger.warn('No target specified');
    return usage(args);
  }
  await command.func({ target, options, config, utils });
  return process.exit(0);
};

run(process.argv.slice(2));

/* eslint-disable no-console */
process.on('unhandledRejection', err => {
  logger.error('Unhandled Rejection', err);
  console.error(err);
});

process.on('uncaughtException', err => {
  logger.error('Unhandled Exception', err);
  console.error(err);
});
/* eslint-enable no-console */
