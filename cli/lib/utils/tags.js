const _ = require('lodash');
const { unflatten } = require('flat');

let config = require('../../config');

const prepareId3Tags = ([file, fields]) => {
  // transform new metadata to id3 keys for saving
  const filteredTags = _.pick(fields, _.map(config.tags, 'name'));
  const editTags = _.mapKeys(filteredTags, (value, name) => _.find(config.tags, { name }).id);

  // special rating handler
  if (fields.rating) {
    editTags[config.rating.tag] = {
      email: config.rating.email,
      rating: Math.round((fields.rating * 255) / config.rating.max)
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

module.exports = customConfig => {
  config = customConfig || config;

  return {
    prepareId3Tags
  };
};
