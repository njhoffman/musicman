const _ = require('lodash');
const NodeId3 = require('node-id3');
const flatten = require('flat');

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

// read metadata tags for files array and return [file, metadata]
const getMetadata = async files =>
  Promise.all([].concat(files).map(async file => Promise.all([file, readMetadata(file)])));

const metakeysTransform = (metadata, config) =>
  _.mapKeys(metadata, (tagVal, tagKey) => {
    const tag = _.find(config.tags, { id: tagKey });
    return tag.name;
  });

const getRating = (rating, ratingMax) => ((rating / 255) * ratingMax).toFixed(1);

// convert id3 tag names to associated tag names in config
const parseMetadata = (rawTags = {}, config) => {
  const selectedTags = flatten(_.pick(rawTags, _.map(config.tags, 'id')));

  // flatten and include relevant TXXX custom tags
  _.each(rawTags.TXXX, ({ description, value }) => {
    const txName = `TXXX.${description}`;
    if (_.find(config.tags, { id: txName })) {
      selectedTags[txName] = value;
    }
  });

  const parsedTags = metakeysTransform(selectedTags, config);

  const ratingTag = _.get(config, 'rating.tag');
  if (rawTags[ratingTag]) {
    parsedTags.rating = getRating(rawTags[ratingTag].rating, config.rating.max);
    // const rating = getRating(rawTags.POPM.rating, config.rating.max);
    // parsedTags[keysById ? ratingTag : 'rating'] = rating;
  }

  return parsedTags;
};

module.exports = { getMetadata, parseMetadata };
