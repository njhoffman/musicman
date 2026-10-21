const path = require('path');
const getCommand = require('./command.js');
const getTarget = require('./target.js');
const getOptions = require('./options.js');

// command line parser for assigning
//   command:  which command to execute
//   target:   what file/directory is the target of the command
//   options:  includes switches, field filters and assignments
const parser = ({ args, currentSong, config }) => {
  const { baseDirectory } = config.mpd;
  const command = getCommand(args, currentSong);
  const target = getTarget({ args, currentSong, baseDirectory, command });

  // drop the command word and the target argument (given relative or absolute) from the options
  const remainingArgs = args.filter(
    (arg, i) => !(i === 0 && arg === command.name) && path.resolve(arg) !== target
  );
  // whether an argument named the target, or it is the command's default (or the playing song)
  const targetGiven = remainingArgs.length < args.length - (args[0] === command.name ? 1 : 0);
  const options = { ...getOptions(remainingArgs, config, command.name), targetGiven };
  return { target, command, options };
};

module.exports = parser;
