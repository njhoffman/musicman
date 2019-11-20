const yargs = require('yargs');
const { checkDirectory, getFiles, getMetadata } = require('../utils');

const handler = async ({ target }) => {
  await checkDirectory(`${target}/.mp3`);
  const files = await getFiles(`${target}/.mp3`, { ext: 'mp3', recursive: true });
  const metaFiles = await getMetadata(files);
  // output according to format setting
  metaFiles.map(mf => console.log(mf));
  return true;
};

const builder = () => {
  return yargs
    .options({
      exclude: {
        description: 'Exclude certain fields from output',
        alias: 'x',
        array: true,
        choices: ['artist', 'title', 'album', 'genre', 'rating']
      }
    })
    .positional('target', {
      description: 'Target directory',
      type: 'string',
      default: process.cwd()
    });
};

module.exports = {
  command: ['view [target]', '$0 [target]'],
  describe: 'View the tags of [target]',
  builder,
  handler
};
