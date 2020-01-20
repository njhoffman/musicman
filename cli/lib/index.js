const commandParser = require('./parser');
const mpdConnect = require('./mpd');
const config = require('../config');
const initUtils = require('./utils');

process.on('unhandledRejection', err => {
  console.log('Unhandled Rejection', err);
  console.error(err);
});

process.on('uncaughtException', err => {
  console.log('Unhandled Exception', err);
  console.error(err);
});

const usage = args => {
  console.log('USAGE', args);
};

const run = async args => {
  const currentSong = await mpdConnect(config.mpd);
  const utils = initUtils(config);

  const { command, target, options } = commandParser({ args, currentSong, config, utils });

  if (!target) {
    console.log('No target specified');
    return usage(args);
  }
  await command.func({ target, options, config, utils });
  return process.exit(0);
};

run(process.argv.slice(2));
