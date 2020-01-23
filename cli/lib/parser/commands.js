const _ = require('lodash');

const commands = require('../commands');

const getCommand = args => {
  const command = (args[0] || '').trim();
  const viewCommand = _.find(commands, { name: 'view' });
  if (!command) {
    return viewCommand;
  }
  if (/^\d+(?:\.\d+)?$/.test(command)) {
    // if first argument is numeric, it is a rating (edit command)
    return _.find(commands, { name: 'edit' });
  } else if (/^\w+=.*/.test(command)) {
    // if first argument includes assignment operator (=), it is an edit
    return _.find(commands, { name: 'edit' });
  }
  return _.find(commands, { name: command }) || viewCommand;
};

module.exports = getCommand;
