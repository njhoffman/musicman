const commandParser = require('./parser');
const mpdConnect = require('./mpd');
const config = require('../config');

process.on('unhandledRejection', err => {
  console.log('Unhandled Rejection');
  console.error(err);
});

const usage = args => {
  console.log('USAGE', args);
};

const run = async args => {
  const currentSong = await mpdConnect(config.mpd);
  const { command, target, options } = commandParser({ args, currentSong, config });

  if (!target) {
    console.log('No target specified or found');
    return usage(args);
  }
  return command.func(target, options, config);
};

run(process.argv.slice(2));
