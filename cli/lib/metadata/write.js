const _ = require('lodash');
const NodeId3 = require('node-id3');
const { unflatten } = require('flat');

const logger = require('../utils/logger');

const toRating = (newRating, ratingMax) => Math.round((newRating * 255) / ratingMax);

const prepareRating = (rating, { min, max, email }) => (rating === '' ? {} : { email, rating: toRating(rating, max) });

const prepareCustomFields = txxxFields =>
  _.map(_.keys(txxxFields), txKey => ({
    description: txKey,
    value: txxxFields[txKey]
  }));

// transform new metadata to id3 keys for saving
const prepareId3Tags = config => ([file, fields]) => {
  const filteredTags = _.pick(fields, _.map(config.tags, 'name'));
  const editTags = _.mapKeys(filteredTags, (value, name) => _.find(config.tags, { name }).id);

  // special rating handler
  if (_.isString(fields.rating)) {
    editTags[config.rating.tag] = prepareRating(fields.rating, config.rating);
  }

  const finalTags = unflatten(editTags);

  // special TXXX keys handler
  finalTags.TXXX = prepareCustomFields(finalTags.TXXX);

  return [file, finalTags];
};

const writeFile = ([file, id3Tags]) => {
  logger.debug(`Writing file: ${file}`, id3Tags);
  return NodeId3.update(id3Tags, file);
};

const writeFiles = config => files => {
  return _.chain(files)
    .map(prepareId3Tags(config))
    .map(writeFile)
    .value();
};

module.exports = { writeFiles };
