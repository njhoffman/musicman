const path = require('path');
const getCommand = require('./command.js');
const getTarget = require('./target.js');
const getOptions = require('./options.js');

// command line parser for assigning
//   command:  which command to execute
//   target:   what file/directory is the target of the command
//   options:  includes switches, field filters and assignments
const _ = require('lodash');
const commands = require('../commands/index.js');
const { checkExists } = require('../utils/files.js');

/**
 * Error for a first argument that is a plain word but not a command, a path, a filter, or a rating, which
 * would otherwise run view on the whole library. Suggests the commands that have a switch by that name.
 */
const unknownCommand = word => {
  const withSwitch = _.filter(commands, ({ switches = [] }) => switches.includes(word));
  const suggestion =
    withSwitch.length > 0
      ? `did you mean ${withSwitch.map(({ name }) => `musicman ${name} --${word}`).join(' or ')}?`
      : `commands are ${_.map(commands, 'name').join(', ')}`;
  return new Error(`Unknown command '${word}', ${suggestion} (musicman --help)`);
};

const parser = ({ args, currentSong, config }) => {
  const { baseDirectory } = config.mpd;
  const command = getCommand(args, currentSong);
  const [first] = args;
  if (
    command.name === 'view' &&
    first &&
    first !== 'view' &&
    /^[A-Za-z][\w-]*$/.test(first) &&
    !checkExists(first)
  ) {
    throw unknownCommand(first);
  }
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
