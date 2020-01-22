const _ = require('lodash');

let config = require('../../config');

const parseSwitches = optionList => {
  const switches = {
    include: [],
    exclude: [],
    recursive: config.recursive
  };
  const remaining = [...optionList];

  optionList.forEach((option, i) => {
    if (option === '-r') {
      switches.recursive = true;
      remaining.splice(i);
    } else if (option === '-nr') {
      switches.recursive = false;
      remaining.splice(i);
    } else if (option === '-x') {
      switches.exclude = optionList[i + 1].split(',');
      remaining.splice(i, 2);
    } else if (option === '-i') {
      switches.include = optionList[i + 1].split(',');
      remaining.splice(i, 2);
      delete remaining[i];
    }
  });
  return { remaining, switches };
};

const parseRating = (rating, type) => ({
  min: rating.split('-')[0],
  max: rating.split('-')[1],
  exclude: type === 'exclude'
});

const parseFilters = optionList => {
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

    if (/^\d+(?:.\d+)?$/.test(option)) {
      // if argument is numeric, assume it's a rating
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

const parseAssignments = optionList => {
  const assignments = {};

  optionList.forEach(option => {
    const [key, val] = option.split('=');
    const tagConfig = _.find(config.tags, { name: key });
    const tagValue = `${val}`.replace(/"/g, '');

    if (key === 'rating') {
      assignments.rating = tagValue;
    } else if (tagConfig) {
      if (tagConfig.multi) {
        assignments[key] = tagValue.split(',').map(tv => tv.trim());
      } else {
        // just assign whole string if not a multi field
        assignments[key] = tagValue;
      }
    }
  });
  return assignments;
};

const getOptions = (optionList, customConfig) => {
  config = customConfig || config;

  // const optionList = options.split(/([\w~]+[:=]"[^"]+")|\s/).filter(Boolean);

  const { switches, remaining } = parseSwitches(optionList);
  const filters = parseFilters(remaining, config);
  const assignments = parseAssignments(remaining, config);

  return { switches, filters, assignments };
};

module.exports = {
  getOptions
};
