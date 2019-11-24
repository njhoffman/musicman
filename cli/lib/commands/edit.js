const yargs = require('yargs');
const { checkDirectory, getFiles, getMetadata } = require('../utils');

const handler = async ({ target }) => {
  console.log('EDIT HANDLER');
  await checkDirectory(`${target}/.mp3`);
  const files = await getFiles(`${target}/.mp3`, { ext: 'mp3', recursive: true });
  // apply all changes
  // output file changes for each file
};

const builder = () => {
  return yargs
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
