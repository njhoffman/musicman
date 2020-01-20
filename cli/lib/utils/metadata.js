const _ = require('lodash');
const flatten = require('flat');
const NodeId3 = require('node-id3');

let config = require('../../config');

const getRating = (rating, ratingMax) => ((rating / 255) * ratingMax).toFixed(1);

const toRating = (newRating, ratingMax) => Math.round((newRating * 255) / ratingMax);

const metakeysTransform = (metadata, keysById) =>
  _.mapKeys(metadata, (tagVal, tagKey) => {
    const tag = _.find(config.tags, { id: tagKey });
    return keysById ? tag.id : tag.name;
  });

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

const getMetadata = async files =>
  Promise.all([].concat(files).map(async file => Promise.all([file, readMetadata(file)])));

const parseMetadata = (rawTags = {}, keysById) => {
  const selectedTags = flatten(_.pick(rawTags, _.map(config.tags, 'id')));

  // flatten and include relevant TXXX custom tags
  _.each(rawTags.TXXX, ({ description, value }) => {
    const txName = `TXXX.${description}`;
    if (_.find(config.tags, { id: txName })) {
      selectedTags[txName] = value;
    }
  });

  const parsedTags = metakeysTransform(selectedTags, keysById);

  const ratingTag = config.rating.tag;
  if (rawTags[ratingTag]) {
    const rating = getRating(rawTags.POPM.rating, config.rating.max);
    parsedTags[keysById ? ratingTag : 'rating'] = rating;
  }

  return parsedTags;
};

const parseFileMetadata = (filesMetadata, keysById) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, keysById)]);

module.exports = customConfig => {
  config = customConfig || config;

  return {
    toRating,
    getRating,
    getMetadata,
    parseFileMetadata
  };
};
