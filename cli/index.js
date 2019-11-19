const yargs = require('yargs');
const { viewCommand, editCommand } = require('./commands');

yargs
  .usage('Usage: $0 <command> [options] [target]')
  .example('$0 edit --title target.mp3')
  .command(viewCommand)
  .command(editCommand)
  .help()
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
  .epilog('The view command is default.')
  .epilog('Providing no options shows tags in current directory.');

// const target = argv._[0] || argv.target;
