const _ = require('lodash');
const { unflatten } = require('flat');

/* tag parsing utilities */

const processFields = config => options => ([file, oldFields]) => {
  const newFields = { ...oldFields };

  // if first argument is numeric, assume it's a rating
  if (/^\d+(?:.\d+)?$/.test(_.first(options))) {
    newFields.rating = _.first(options);
  }

  options.forEach(option => {
    const [key, rest] = option.split(/(\w+:"[^"]+")|\s/);
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

const prepareId3Tags = config => ([file, fields]) => {
  const filteredTags = _.pick(fields, _.map(config.tags, 'name'));
  const editTags = _.mapKeys(filteredTags, (value, name) => _.find(config.tags, { name }).id);

  if (fields.rating) {
    editTags[config.rating.tag] = {
      email: config.rating.email,
      rating: Math.round((fields.rating * 255) / config.rating.max)
    };
  }

  const finalTags = unflatten(editTags);
  finalTags.TXXX = _.map(_.keys(finalTags.TXXX), txKey => ({
    description: txKey,
    value: finalTags.TXXX[txKey]
  }));
  return [file, finalTags];
};

module.exports = config => ({ prepareId3Tags: prepareId3Tags(config), processFields: processFields(config) });
