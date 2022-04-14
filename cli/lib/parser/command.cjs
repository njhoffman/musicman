const _ = require('lodash');

const commands = require('../commands/index.cjs');

const getCommand = (args, currentSong) => {
  const firstArg = (args[0] || '').trim();
  const viewCommand = _.find(commands, { name: 'view' });
  const editCommand = _.find(commands, { name: 'edit' });

  if (/^\d+(?:\.\d+)?$/.test(firstArg)) {
    // if first argument is numeric, it is a rating, editing if current song playing
    return currentSong ? editCommand : viewCommand;
  }

  let matchedCommand = _.find(commands, { name: firstArg });
  if (!matchedCommand) {
    _.some(args, arg => {
      if (/^\w+=.*/.test(arg)) {
        // if any argument has assignment operator (=), it is an editing command
        matchedCommand = editCommand;
      }
      return matchedCommand;
    });
  }

  // try to match command, otherwise assume view command
  return matchedCommand || viewCommand;
};

module.exports = getCommand;
