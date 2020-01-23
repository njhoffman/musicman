const getCommand = require('./parser/commands');
const getTarget = require('./parser/target');
const getOptions = require('./parser/options');

const usage = args => {
  console.log(args);
};

const parser = ({ args, currentSong, config, utils }) => {
  const { baseDirectory } = config.mpd;
  const target = getTarget({ args, currentSong, baseDirectory, utils });
  const command = getCommand(args);

  const remainingArgs = args.filter(arg => arg !== target && arg !== command);
  const options = getOptions(remainingArgs, config);
  return { target, command, options };
};

module.exports = parser;
