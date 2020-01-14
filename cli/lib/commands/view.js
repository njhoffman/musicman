const _ = require('lodash');
const yargs = require('yargs');
const columnify = require('columnify');
const { inspect } = require('util');

const config = require('../../config');
const { checkExists, getFiles, getMetadata, parseFileMetadata } = require('../utils');

const handler = async ({ target = process.cwd(), format }) => {
  const exists = await checkExists(target);
  const files = exists.isDirectory() ? await getFiles(target, { ext: 'mp3', recursive: true }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);
  const metadata = _.map(parsedMetadata, ([file, meta]) => meta);

  if (metadata.length === 0) {
    console.log(`\nNo mp3 files found in ${target}`);
  } else if (format === 'vertical' || metadata.length === 1) {
    const metadataJson = inspect(metadata[0], { colors: true, compact: false })
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n');
    console.log(metadataJson);
  } else {
    const columns = ['rating'].concat(
      _.chain(config.tags)
        .filter('viewIndex')
        .sortBy('viewIndex')
        .map('name')
        .value()
    );
    console.log(columnify(metadata, { columns, maxLineWidth: 'auto' }));
  }
  process.exit(0);
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
      type: 'string'
    });
};

module.exports = {
  command: ['view [target]', '$0 [target]'],
  describe: 'View the tags of <target>',
  builder,
  handler
};
