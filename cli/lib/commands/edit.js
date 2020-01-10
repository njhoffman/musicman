const _ = require('lodash');
const chalk = require('chalk');
const yargs = require('yargs');
const diff = require('diff');

const NodeId3 = require('../../../common/node-id3v2');
const config = require('../../config');
const { checkExists, getFiles, getMetadata } = require('../utils');

const processEditTags = args => {
  const editTags = _.mapKeys(
    _.pick(args, _.map(config.tags, 'name')),
    (value, name) => _.find(config.tags, { name }).id
  );

  if (args.rating) {
    editTags[config.rating.tag] = {
      email: config.rating.email,
      rating: Math.round((args.rating * 255) / config.rating.max)
    };
  }
  return editTags;
};

const handler = async ({ target, ...args }) => {
  if (!target) {
    throw new Error('No target for editing specified');
  }

  const exists = await checkExists(target);
  const files = exists.isDirectory() ? await getFiles(target, { ext: 'mp3', recursive: true }) : target;

  const origMetaFiles = await getMetadata(files, true);
  const origMetadata = _.map(origMetaFiles, ([file, meta]) => meta);
  const editTags = processEditTags(args);

  // apply all changes
  // output file changes for each file
  NodeId3.update(editTags, target);
  // console.log('EDIT TAGS', editTags);
  const metaFiles = await getMetadata(files, true);
  const metadata = _.map(metaFiles, ([file, meta]) => meta);

  const differences = diff.diffJson(origMetadata, metadata);
  differences.forEach(part => {
    // green for additions, red for deletions
    // grey for common parts
    let color = 'grey';
    if (part.added) {
      color = 'green';
    } else if (part.removed) {
      color = 'red';
    }
    process.stderr.write(chalk[color](part.value));
  });
  console.log();
  process.exit(0);
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
      type: 'string'
    });
};

module.exports = {
  command: ['edit [target]'],
  describe: 'Update tags for all files in [target]',
  builder,
  handler
};
