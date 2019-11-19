const yargs = require('yargs');

const handler = (...args) => {
  console.log('VIEW HANDLER', args);
  // check if directory exists
  // if it doesn't, exit
  // if it does, itemize files (recursive if necessary)
  // output according to format setting
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
