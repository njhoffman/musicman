const yargs = require('yargs');
const path = require('path');
const chalk = require('chalk');
const _ = require('lodash');
const config = require('../config');
const { MpdClient } = require('../../common/mpd/MpdClient');
const { viewCommand, editCommand } = require('./commands');

process.on('unhandledRejection', err => {
  console.log('Unhandled Rejection');
  console.error(err);
});

// mr ./album
// mr --rating 4.5 ./album/file.mp3
// mr -x artist,title,year
// mr -i title,rating,context --format=table
//
// if mpd playing:
//   mr (view tags of current song)
//   mr --rating 4.5 --context +Pool --mood +Mellow +Relaxing
//   mr --rating=4.5 --mood=Mellow,Relaxing
//   mr 4.5
// if mpd not playing:
//   mr (view tags in current directory)
//   mr --rating 4.5 (throws usage)

const connectMpd = argv =>
  new Promise((resolve, reject) => {
    const mpdClient = MpdClient.connect({ port: config.mpd.port, host: config.mpd.host });

    mpdClient.on('error', err => {
      console.error('MPD ERROR', err);
      throw new Error(err);
    });

    mpdClient.on('ready', async () => {
      console.log(`\nMPD connected at ${chalk.bold(config.mpd.host)}:${chalk.cyan(config.mpd.port)}\n`);
      const currentSong = await mpdClient.sendCommandAsync('currentsong');
      let target = argv.target || currentSong.file;

      if (currentSong.file && !argv.target) {
        target = path.join(config.mpd.baseDirectory, currentSong.file);
        console.log(`No target specified, assigning to current song:\n  ${chalk.green(target)}\n`);
      }
      resolve({ ...argv, target });
    });
  });

const globalOptions = {
  format: {
    description: 'Output format',
    default: 'table',
    choices: ['table', 'vertical']
  },
  recursive: {
    description: 'Recurse all subdirectories of [target]',
    type: 'boolean',
    default: false
  }
};

const { argv } = yargs
  .usage('Usage: $0 <command> [options] [target]')
  .example('$0 --rating 4.5 --mood +Relaxing ./target.mp3')
  .command(viewCommand)
  .command(editCommand)
  .options(globalOptions)
  .middleware(connectMpd)
  .showHelpOnFail(true, 'Specify --help for available options')
  .help('help')
  .epilog('The view command is default.')
  .epilog('Providing no options shows tags in current directory.');

// exits right away if argv not assigned from yargs chain
// console.log(`\nFinished with ${argv.$0}`);
