const commandParser = require('./parser');
const mpdConnect = require('./mpd');
const config = require('../config');
const initUtils = require('./utils');

process.on('unhandledRejection', err => {
  console.log('Unhandled Rejection');
  console.error(err);
});

const usage = args => {
  console.log('USAGE', args);
};

const run = async args => {
  const utils = initUtils(config);
  const currentSong = await mpdConnect(config.mpd);
  const utils = initUtils(config);

  const { command, target, options } = commandParser({ args, currentSong, config });

  if (!target) {
    console.log('No target specified');
    return usage(args);
  }
  return command.func(target, options, config, utils);
};

run(process.argv.slice(2));
