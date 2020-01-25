const getCommand = require('./parser/command');
const getTarget = require('./parser/target');
const getOptions = require('./parser/options');

const parser = ({ args, currentSong, config }) => {
  const { baseDirectory } = config.mpd;
  const target = getTarget({ args, currentSong, baseDirectory });
  const command = getCommand(args, currentSong);

  const remainingArgs = args.filter(arg => arg !== target && arg !== command);
  const options = getOptions(remainingArgs, config);
  return { target, command, options };
};

module.exports = parser;
