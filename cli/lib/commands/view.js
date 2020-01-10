const _ = require('lodash');
const yargs = require('yargs');
const columnify = require('columnify');

const { checkExists, getFiles, getMetadata } = require('../utils');

const handler = async ({ target = process.cwd(), format }) => {
  const exists = await checkExists(target);
  const files = exists.isDirectory() ? await getFiles(target, { ext: 'mp3', recursive: true }) : target;

  const metaFiles = await getMetadata(files);
  const metadata = _.map(metaFiles, ([file, meta]) => meta);

  if (metadata.length === 0) {
    console.log(`\nNo mp3 files found in ${target}`);
  } else if (format === 'vertical' || metadata.length === 1) {
    console.log(metadata[0]);
  } else {
    console.log(columnify(metadata, { maxLineWidth: 'auto' }));
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
