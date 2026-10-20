const parseSwitches = require('./options/switches.js');
const parseFilters = require('./options/filters.js');
const parseAssignments = require('./options/assignments.js');

const getOptions = (optionList, config, commandName) => {
  const { switches, remaining } = parseSwitches(optionList, config);
  const filters = parseFilters(remaining, config, commandName);
  const assignments = parseAssignments(remaining, config, commandName);

  return { switches, filters, assignments };
};

module.exports = getOptions;
