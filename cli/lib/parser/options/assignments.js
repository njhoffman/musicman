const _ = require('lodash');

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

module.exports = parseAssignments;
