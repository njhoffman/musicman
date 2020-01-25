const _ = require('lodash');
const NodeId3 = require('node-id3');
const { unflatten } = require('flat');

const toRating = (newRating, ratingMax) => Math.round((newRating * 255) / ratingMax);

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

const writeFile = ([file, id3Tags]) => NodeId3.update(id3Tags, file);

const writeFiles = config => files =>
  _.chain(files)
    .map(prepareId3Tags(config))
    .map(writeFile)
    .value();

module.exports = { writeFiles };
