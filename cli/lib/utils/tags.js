const _ = require('lodash');
const { unflatten } = require('flat');

let config = require('../../config');

const processFields = options => ([file, oldFields]) => {
  const newFields = { ...oldFields };

  // if first argument is numeric, assume it's a rating
  if (/^\d+(?:.\d+)?$/.test(_.first(options))) {
    newFields.rating = _.first(options);
  }

  options.forEach(option => {
    const [key, rest] = option.split(':');
    const tagConfig = _.find(config.tags, { name: key });
    const tagValue = `${rest}`.split(' ')[0].replace(/"/g, '');

    if (key === 'rating') {
      newFields.rating = tagValue;
    } else if (tagConfig) {
      if (tagConfig.multi && /[+-]+/.test(tagValue)) {
        // multi field assignments rely on existing tag metadata
        const multiVals = (oldFields[key] || '').split(',');
        tagValue.split(',').forEach(val => {
          if (/^\+/.test(val)) {
            // add comma separeted items prefixed with '+'
            multiVals.push(val.slice(1));
          } else if (/^-/.test(val)) {
            // remove ones prefixed with '-'from existing tags
            _.remove(multiVals, mv => val.slice(1) === mv);
          }
        });

        newFields[key] = _.uniq(multiVals)
          .filter(Boolean)
          .join(',');
      } else {
        // just assign whole string if not a multi field
        newFields[key] = tagValue;
      }
    }
  });
  return [file, newFields];
};

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
    prepareId3Tags,
    processFields
  };
};
