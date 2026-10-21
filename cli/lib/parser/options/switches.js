const _ = require('lodash');
const switchMap = require('./switchMap.js');

// --name=value is the same as --name value for switches that take a value
const expandValues = optionList =>
  _.flatMap(optionList, option => {
    const match = option.match(/^--([\w-]+)=(.*)$/);
    return match && _.get(switchMap, [match[1], 'value']) ? [`--${match[1]}`, match[2]] : [option];
  });

const parseSwitches = (args, config) => {
  const switches = {};
  const used = [];
  const optionList = expandValues(args);

  optionList.forEach((option, i) => {
    // long form (--update) matches the switch name, short form (-u) matches the alias; bare words
    // are not switches so a target named like a switch (e.g. a "files" directory) still works
    const longName = /^--/.test(option) ? option.slice(2) : null;
    const foundSwitch =
      (longName && _.get(switchMap, longName)) || _.find(switchMap, { alias: option });
    if (foundSwitch) {
      used.push(option, foundSwitch.alias);
      _.merge(switches, foundSwitch.func(used, optionList, i));
    }
  });

  const remaining = _.without(optionList, ...used);
  return { remaining, switches };
};

module.exports = parseSwitches;
