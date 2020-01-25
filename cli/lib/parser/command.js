const _ = require('lodash');

const commands = require('../commands');

const getCommand = (args, currentSong) => {
  const firstArg = (args[0] || '').trim();
  const viewCommand = _.find(commands, { name: 'view' });
  const editCommand = _.find(commands, { name: 'edit' });

  if (/^\d+(?:\.\d+)?$/.test(firstArg)) {
    // if first argument is numeric, it is a rating, editing if current song playing
    return currentSong ? editCommand : viewCommand;
  } else if (/^\w+=.*/.test(firstArg)) {
    // if first argument includes assignment operator (=), it is an edit
    return editCommand;
  }

  // try to match command, otherwise assume view command
  return _.find(commands, { name: firstArg }) || viewCommand;
};

module.exports = getCommand;
