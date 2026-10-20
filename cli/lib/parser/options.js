const parseSwitches = require('./options/switches.js');
const parseFilters = require('./options/filters.js');
const parseAssignments = require('./options/assignments.js');

const getOptions = (optionList, config, commandName) => {
  const { switches, remaining } = parseSwitches(optionList, config);
  const filters = parseFilters(remaining, config, commandName);
  const assignments = parseAssignments(remaining, config, commandName);

  // non-switch arguments, for commands that parse their own terms (search)
  return { switches, filters, assignments, terms: remaining };
};

module.exports = getOptions;
