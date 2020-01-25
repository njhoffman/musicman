const _ = require('lodash');
const switchMap = require('./switchMap');

const parseSwitches = (optionList, config) => {
  const switches = {};
  const used = [];

  optionList.forEach((option, i) => {
    const foundSwitch = _.get(switchMap, option) || _.find(switchMap, { alias: option });
    if (foundSwitch) {
      used.push(foundSwitch.alias, _.keys(foundSwitch)[0]);
      _.merge(switches, foundSwitch.func(used, optionList, i));
    }
  });

  const remaining = _.without(optionList, ...used);
  return { remaining, switches };
};

module.exports = parseSwitches;
