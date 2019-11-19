const yargs = require('yargs');

const handler = (...args) => {
  console.log('EDIT HANDLER', args);
  // check if directory exists
  // if it doesn't, exit
  // if it does, itemize files (recursive if necessary)
  // apply all changes
  // output file changes for each file
};

const builder = () => {
  yargs
    .options({
      title: {
        description: 'Assign title to all files',
        type: 'string'
      },
      artist: {
        description: 'Assign artist to all files',
        type: 'string'
      },
      album: {
        description: 'Assign album to all files',
        type: 'string'
      },
      genre: {
        description: 'Assign genre to all files',
        type: 'string'
      },
      rating: {
        description: 'Assign rating to all files'
      }
    })
    .positional('target', {
      description: 'Target directory',
      type: 'string',
      default: process.cwd()
    });
};

module.exports = {
  command: 'edit [target]',
  describe: 'Update tags for all files in [target]',
  builder,
  handler
};
