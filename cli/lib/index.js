const yargs = require('yargs');
const { viewCommand } = require('./commands');

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

const { argv } = yargs
  .usage('Usage: $0 [options] [target]')
  .example('$0 --rating 4.5 --mood +Relaxing ./target.mp3')
  .command(viewCommand)
  .options({
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
  })
  .showHelpOnFail(false, 'Specify --help for available options')
  .help('help')
  .epilog('The view command is default.')
  .epilog('Providing no options shows tags in current directory.');

// exits right away if argv not assigned from yargs chain
// console.log(`Finished with ${argv.target}`);
