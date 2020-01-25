const _ = require('lodash');
const flatten = require('flat');
const NodeId3 = require('node-id3');

const { unflatten } = flatten;
// let config = require('../../config');

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
const toRating = (newRating, ratingMax) => Math.round((newRating * 255) / ratingMax);

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

// transform new metadata to id3 keys for saving
const prepareId3Tags = config => ([file, fields]) => {
  const filteredTags = _.pick(fields, _.map(config.tags, 'name'));
  const editTags = _.mapKeys(filteredTags, (value, name) => _.find(config.tags, { name }).id);

  // special rating handler
  if (fields.rating === '') {
    editTags[config.rating.tag] = {};
  } else if (_.isString(fields.rating)) {
    editTags[config.rating.tag] = {
      email: config.rating.email,
      rating: toRating(fields.rating, config.rating.max)
    };
  }

  const finalTags = unflatten(editTags);
  // special TXXX keys handler
  finalTags.TXXX = _.map(_.keys(finalTags.TXXX), txKey => ({
    description: txKey,
    value: finalTags.TXXX[txKey]
  }));
  return [file, finalTags];
};

// TODO: put into common, have separate individual file save with logging
const saveMetadata = (files, config) =>
  files.map(prepareId3Tags(config)).map(([file, id3Tags]) => NodeId3.update(id3Tags, file));

module.exports = {
  getMetadata,
  parseMetadata,
  saveMetadata
};
