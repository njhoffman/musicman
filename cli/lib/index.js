const commandParser = require('./parser');
const mpdConnect = require('./clients/mpd');
const config = require('../config');
const logger = require('./utils/logger');

const usage = args => {
  logger.info('USAGE', args);
};

const run = async args => {
  const currentSong = await mpdConnect(config.mpd);

  const { command, target, options } = commandParser({ args, currentSong, config });

  if (!target) {
    logger.warn('No target specified');
    return usage(args);
  }
  console.log('OPTIONS', options);
  await command.func({ target, options, config });
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
