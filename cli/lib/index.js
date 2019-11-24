const yargs = require('yargs');
const { viewCommand, editCommand } = require('./commands');

process.on('unhandledRejection', err => {
  console.log('Unhandled Rejection');
  console.error(err);
});

const { argv } = yargs
  .usage('Usage: $0 <command> [options] [target]')
  .example('$0 edit --title target.mp3')
  .command(viewCommand)
  .command(editCommand)
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
