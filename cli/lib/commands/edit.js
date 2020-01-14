const _ = require('lodash');
const chalk = require('chalk');
const yargs = require('yargs');
const diff = require('diff');
const { unflatten } = require('flat');

const NodeId3 = require('node-id3');
const config = require('../../config');
const { checkExists, getFiles, getMetadata, parseFileMetadata } = require('../utils');

const processEditTags = args => {
  const filteredTags = _.pick(args, _.map(config.tags, 'name'));
  const editTags = _.mapKeys(filteredTags, (value, name) => _.find(config.tags, { name }).id);

  if (args.rating) {
    editTags[config.rating.tag] = {
      email: config.rating.email,
      rating: Math.round((args.rating * 255) / config.rating.max)
    };
  }

  const finalTags = unflatten(editTags);
  finalTags.TXXX = _.map(_.keys(finalTags.TXXX), txKey => ({
    description: txKey,
    value: finalTags.TXXX[txKey]
  }));
  return finalTags;
};

const outputDifferences = (orig, curr) => {
  const differences =
    orig.length === 1 && curr.length === 1 ? diff.diffJson(orig[0], curr[0]) : diff.diffJson(orig, curr);

  let diffOut = '';
  differences.forEach(part => {
    let color = 'grey';
    if (part.added) {
      color = 'green';
    } else if (part.removed) {
      color = 'red';
    }
    // process.stderr.write(`  ${chalk[color](part.value).trim()}`);
    diffOut += `${chalk[color](part.value)}`;
  });
  console.log(diffOut);
};

const handler = async ({ target, ...args }) => {
  if (!target) {
    throw new Error('No target for editing specified');
  }

  const exists = await checkExists(target);
  const files = exists.isDirectory() ? await getFiles(target, { ext: 'mp3', recursive: true }) : target;
  const origMetadata = parseFileMetadata(await getMetadata(files));

  const editTags = processEditTags(args);
  // const editTags = { TXXX: [{ description: 'Context', value: 'poop' }] };

  // apply all changes
  const result = NodeId3.update(editTags, target);

  const metadata = parseFileMetadata(await getMetadata(files));
  outputDifferences(origMetadata, metadata);

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
