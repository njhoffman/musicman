const _ = require('lodash');
const { promisify } = require('util');
const { stat } = require('fs');
const glob = require('glob');
const NodeID3 = require('node-id3');

const config = require('../config');

const checkDirectory = async dir => promisify(stat)(dir);

const getFiles = async (dir, options = { ext: '*', recursive: false }) => {
  const { recursive, ext } = options;
  const globPath = recursive ? `${dir}/**/*.${ext}` : `${dir}/*.${ext}`;
  const files = await promisify(glob)(globPath);
  return files;
};

const readMetadata = file =>
  new Promise((resolve, reject) => {
    // console.log('READING', file);
    NodeID3.read(file, (err, tags) => resolve(tags.raw));
  });

const parseMetadata = rawTags => {
  const selectedTags = _.pick(rawTags, _.map(config.tags, 'id'));

  // flatten and include relevant TXXX custom tags
  _.each(rawTags.TXXX, txTag => {
    const txName = `TXXX=${txTag.description}`;
    if (_.find(config.tags, { id: txName })) {
      selectedTags[`TXXX=${txTag.description}`] = txTag.value;
    }
  });

  const parsedTags = _.mapKeys(selectedTags, (tagVal, tagKey) => {
    const tagName = _.find(config.tags, { id: tagKey }).name;
    return tagName;
  });

  if (rawTags.POPM) {
    // TODO: convert to 0.0 - 5.0 scale
    parsedTags.rating = rawTags.POPM.rating / 1;
  }

  return parsedTags;
};

const getMetadata = async files => {
  const filesMetadata = await Promise.all(files.map(async file => Promise.all([file, readMetadata(file)])));
  const parsedMetadata = _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata)]);
  return parsedMetadata;
};

module.exports = { getFiles, checkDirectory, getMetadata };
