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

module.exports = parseSwitches;
