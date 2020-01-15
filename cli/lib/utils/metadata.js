const _ = require('lodash');
const flatten = require('flat');
const NodeId3 = require('node-id3');

const getRating = (rating, ratingMax) => ((rating / 255) * ratingMax).toFixed(1);

const toRating = (newRating, ratingMax) => Math.round((newRating * 255) / ratingMax);

const metakeysTransform = (metadata, keysById, configTags) =>
  _.mapKeys(metadata, (tagVal, tagKey) => {
    const tag = _.find(configTags, { id: tagKey });
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

const parseMetadata = (rawTags, keysById, config) => {
  const selectedTags = flatten(_.pick(rawTags, _.map(config.tags, 'id')));

  // flatten and include relevant TXXX custom tags
  _.each(rawTags.TXXX, ({ description, value }) => {
    const txName = `TXXX.${description}`;
    if (_.find(config.tags, { id: txName })) {
      selectedTags[txName] = value;
    }
  });

  const parsedTags = metakeysTransform(selectedTags, keysById, config.tags);

  const ratingTag = config.rating.tag;
  if (rawTags[ratingTag]) {
    const rating = getRating(rawTags.POPM.rating, config.rating.max);
    parsedTags[keysById ? ratingTag : 'rating'] = rating;
  }

  return parsedTags;
};

const parseFileMetadata = config => (filesMetadata, keysById) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, keysById, config)]);

module.exports = config => ({
  toRating,
  getRating,
  getMetadata,
  parseFileMetadata: parseFileMetadata(config)
});
