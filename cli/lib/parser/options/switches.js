const _ = require('lodash');
const switchMap = require('./switchMap.js');

const parseSwitches = (optionList, config) => {
  const switches = {};
  const used = [];

  optionList.forEach((option, i) => {
    // long form (--update) matches the switch name, short form (-u) matches the alias
    const longName = /^--/.test(option) ? option.slice(2) : null;
    const foundSwitch =
      (longName && _.get(switchMap, longName)) ||
      _.get(switchMap, option) ||
      _.find(switchMap, { alias: option });
    if (foundSwitch) {
      used.push(option, foundSwitch.alias);
      _.merge(switches, foundSwitch.func(used, optionList, i));
    }
  });

  const remaining = _.without(optionList, ...used);
  return { remaining, switches };
};

module.exports = parseSwitches;
