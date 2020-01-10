const _ = require('lodash');
const flatten = require('flat');
const { promisify } = require('util');
const { stat } = require('fs');
const glob = require('glob');
const NodeId3 = require('../../common/node-id3v2');

const config = require('../config');

const checkExists = async target => promisify(stat)(target);

const getFiles = async (dir, options = { ext: '*', recursive: false }) => {
  const { recursive, ext } = options;
  const globPath = recursive ? `${dir}/**/*.${ext}` : `${dir}/*.${ext}`;
  const files = await promisify(glob)(globPath);
  return files;
};

const readMetadata = file =>
  new Promise((resolve, reject) => {
    NodeId3.read(file, (err, tags) => {
      if (err) {
        reject(err);
      } else {
        // console.log(tags.raw);
        resolve(tags.raw);
      }
    });
  });

const parseMetadata = (rawTags, keysById) => {
  const selectedTags = flatten(_.pick(rawTags, _.map(config.tags, 'id')));

  // flatten and include relevant TXXX custom tags
  _.each(rawTags.TXXX, ({ description, value }) => {
    const txName = `TXXX.${description}`;
    if (_.find(config.tags, { id: txName })) {
      selectedTags[txName] = value;
    }
  });

  const parsedTags = _.mapKeys(selectedTags, (tagVal, tagKey) => {
    const tag = _.find(config.tags, { id: tagKey });
    return keysById ? tag.id : tag.name;
  });

  if (rawTags.POPM) {
    parsedTags.rating = ((rawTags.POPM.rating / 255) * config.rating.max).toFixed(1);
  }

  return parsedTags;
};

const getMetadata = async (files, keysById = false) => {
  const filesMetadata = await Promise.all([].concat(files).map(async file => Promise.all([file, readMetadata(file)])));
  const parsedMetadata = _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, keysById)]);
  return parsedMetadata;
};

module.exports = { getFiles, checkExists, getMetadata };
