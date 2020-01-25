const _ = require('lodash');

const parseSwitches = (optionList, config) => {
  const switches = {
    include: [],
    exclude: [],
    recursive: config.recursive
  };
  const used = [];

  // TODO: add double-dash alternatives
  optionList.forEach((option, i) => {
    if (option === '-r') {
      switches.recursive = true;
      used.push('-r');
    } else if (option === '-nr') {
      switches.recursive = false;
      used.push('-nr');
    } else if (option === '-x') {
      switches.exclude = optionList[i + 1].split(',');
      used.push('-x', optionList[i + 1]);
    } else if (option === '-i') {
      switches.include = optionList[i + 1].split(',');
      used.push('-i', optionList[i + 1]);
    }
  });

  const remaining = _.without(optionList, ...used);
  return { remaining, switches };
};

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

const parseAssignments = (optionList, config, commandName) => {
  const assignments = {};

  optionList.forEach(option => {
    const [key, val] = option.split('=');
    const tagConfig = _.find(config.tags, { name: key });
    const tagValue = `${val}`.replace(/"/g, '');

    if (/^\d+(?:.\d+)?$/.test(option) && commandName === 'edit') {
      assignments.rating = option;
    } else if (key === 'rating') {
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

const getOptions = (optionList, config, commandName) => {
  const { switches, remaining } = parseSwitches(optionList, config);
  const filters = parseFilters(remaining, config, commandName);
  const assignments = parseAssignments(remaining, config, commandName);

  return { switches, filters, assignments };
};

module.exports = getOptions;
