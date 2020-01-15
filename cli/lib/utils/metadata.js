const _ = require('lodash');
const flatten = require('flat');
const NodeId3 = require('node-id3');

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

const getMetadata = async file =>
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

const parseFileMetadata = config => (filesMetadata, keysById) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, keysById, config)]);

module.exports = config => {
  getMetadata, parseFileMetadata(config);
};
