const commandParser = require('./parser');
const { getCurrentSong, connectMpd } = require('./clients/mpd');
const config = require('../../common/config');
const logger = require('./utils/logger');

const usage = args => {
  // logger.info('USAGE', args);
};

const run = async args => {
  const mpdClient = await connectMpd(config.mpd);
  const currentSong = await getCurrentSong(mpdClient);

  const { command, target, options } = commandParser({ args, currentSong, config });

  if (!target) {
    throw new Error('No target specified');
    // return usage(args);
  }
  await command.func({
    target,
    options: { ...options, commandName: command.name },
    config
  });
  return process.exit(0);
};

run(process.argv.slice(2));

/* eslint-disable no-console */
process.on('unhandledRejection', err => {
  // logger.error(`${err.name}: ${err.message}`);
  console.error(err);
  process.exit(1);
});

process.on('uncaughtException', err => {
  logger.error('Unhandled Exception', err);
  console.error(err);
});
/* eslint-enable no-console */
