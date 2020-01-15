const _ = require('lodash');
const yargs = require('yargs');
const columnify = require('columnify');
const { inspect } = require('util');

const config = require('../../config');
const { checkExists, getFiles, getMetadata, parseFileMetadata } = require('../utils');

const handler = args => {
  console.log('THIS IS MY HANDLER', args);
};

const builder = () => {
  return yargs
    .options({
      exclude: {
        description: 'Exclude certain field patterns from playlist',
        alias: 'x',
        array: true,
        choices: ['artist', 'title', 'album', 'genre', 'rating']
      },
      exclude: {
        description: 'Only include songs with certain field patterns',
        alias: 'i',
        array: true,
        choices: ['artist', 'title', 'album', 'genre', 'rating']
      }
    })
    .positional('target', {
      description: 'Target directory',
      type: 'string'
    });
};

module.exports = {
  command: ['playlist [target]', 'ps [target]'],
  describe: 'Generate playlist with field patterns ',
  builder,
  handler
};
