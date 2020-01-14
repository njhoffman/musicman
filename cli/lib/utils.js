const _ = require('lodash');
const flatten = require('flat');
const { promisify } = require('util');
const { stat } = require('fs');
const glob = require('glob');
const NodeId3 = require('node-id3');

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

  const ratingTag = config.rating.tag;
  if (rawTags[ratingTag]) {
    parsedTags[keysById ? ratingTag : 'rating'] = ((rawTags.POPM.rating / 255) * config.rating.max).toFixed(1);
  }

  return parsedTags;
};

const parseFileMetadata = (filesMetadata, keysById) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, keysById)]);

const getMetadata = async files =>
  Promise.all([].concat(files).map(async file => Promise.all([file, readMetadata(file)])));

module.exports = { getFiles, checkExists, getMetadata, parseFileMetadata };
