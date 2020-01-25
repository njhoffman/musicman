const _ = require('lodash');

const parseRating = (rating, type) => ({
  min: rating.split('-')[0],
  max: rating.split('-')[1],
  exclude: type === 'exclude'
});

const parseFilters = (optionList, config, commandName) => {
  const filters = {
    include: {},
    exclude: {},
    rating: { min: null, max: null, exclude: false }
  };

  optionList.forEach(option => {
    const [key, val] = option.split(':');
    const filterKey = key.replace(/^~/, '');
    const tagConfig = _.find(config.tags, { name: filterKey });
    const tagValue = `${val}`.replace(/"/g, '');
    const type = /^~/.test(key) ? 'exclude' : 'include';

    if (/^\d+(?:.\d+)?$/.test(option) && commandName !== 'edit') {
      // if argument is numeric and not editing command, assume it's a rating
      filters.rating = parseRating(option, type);
    } else if (filterKey === 'rating') {
      filters.rating = parseRating(tagValue, type);
    } else if (tagConfig) {
      if (tagConfig.multi) {
        filters[type][filterKey] = tagValue.split(',').map(tv => tv.trim());
      } else {
        // just assign whole string if not a multi field
        filters[type][filterKey] = tagValue;
      }
    }
  });
  return filters;
};

module.exports = parseFilters;
