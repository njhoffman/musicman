const _ = require('lodash');
const yargs = require('yargs');
const columnify = require('columnify');

const config = require('../../config');
const { checkDirectory, getFiles, getMetadata } = require('../utils');

const handler = async ({ target }) => {
  await checkDirectory(`${target}/.mp3`);
  const files = await getFiles(`${target}/.mp3`, { ext: 'mp3', recursive: true });
  const metaFiles = await getMetadata(files);

  const { viewTags } = config;
  const outputFiles = metaFiles.map(mf => {
    const tags = _.pick(mf, viewTags);
    // special formatting, TODO: make mapping function
    if (tags.rating && tags.rating.length > 0) {
      tags.rating = _.toNumber(tags.rating.pop().rating.toFixed(4));
    }
    if (tags.picture) {
      tags.picture = tags.picture.length;
    }
    if (tags.genre) {
      tags.genre = tags.genre.join('|');
    }
    if (tags.artists) {
      tags.artists = tags.artists.join('|');
    }
    return tags;
  });

  // TODO: output according to format setting
  console.log(columnify(outputFiles, { maxLineWidth: 'auto' }));
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
