const getCommand = require('./parser/command');
const getTarget = require('./parser/target');
const getOptions = require('./parser/options');

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
