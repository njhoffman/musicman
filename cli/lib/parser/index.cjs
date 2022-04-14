const getCommand = require('./command.cjs');
const getTarget = require('./target.cjs');
const getOptions = require('./options.cjs');

// command line parser for assigning
//   command:  which command to execute
//   target:   what file/directory is the target of the command
//   options:  includes switches, field filters and assignments
const parser = ({ args, currentSong, config }) => {
  const { baseDirectory } = config.mpd;
  const command = getCommand(args, currentSong);
  const target = getTarget({ args, currentSong, baseDirectory, command });

  const remainingArgs = args.filter(arg => arg !== target && arg !== command);
  const options = getOptions(remainingArgs, config, command.name);
  return { target, command, options };
};

module.exports = parser;
