const parseSwitches = require('./options/switches');
const parseFilters = require('./options/filters');
const parseAssignments = require('./options/assignments');

const getOptions = (optionList, config, commandName) => {
  const { switches, remaining } = parseSwitches(optionList, config);
  const filters = parseFilters(remaining, config, commandName);
  const assignments = parseAssignments(remaining, config, commandName);

  return { switches, filters, assignments };
};

module.exports = getOptions;
