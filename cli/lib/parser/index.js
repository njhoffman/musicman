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
const { filterProblems } = require('musicman-common/config/validator.js');
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

/**
 * Refuses filters with a field that is not a library tag (or rating): parseFilters ignores them, so a
 * typo like contxt:Study would list (or change) every song. Commands that read their own terms (search
 * and player, where such a term is free text) are left alone, and so are URLs and spotify: URIs.
 */
const checkFilterFields = (terms, config, command) => {
  if (command.ownTerms) {
    return;
  }
  const filterLike = _.filter(
    terms,
    term => /^~?[\w-]+:/.test(term) && !/^[a-z]+:\/\//i.test(term) && !/^spotify:/.test(term)
  );
  const fieldNames = new Set(_.map(_.get(config, 'library.tags'), 'name'));
  const [problem] = filterProblems(filterLike, fieldNames);
  if (problem) {
    throw new Error(
      `Filter ${problem}: fields are rating, ${_.sortBy([...fieldNames]).join(', ')}`
    );
  }
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
  checkFilterFields(options.terms, config, command);
  // commands that take only switches reject other words, e.g. sync push for sync --push
  if (command.terms === false && options.terms.length > 0) {
    const [word] = options.terms;
    const name = word.replace(/^-+/, '');
    const hint = (command.switches || []).includes(name)
      ? `did you mean --${name}?`
      : `it takes only switches: ${_.map(command.switches, s => `--${s}`).join(' ')}`;
    throw new Error(`musicman ${command.name} does not take '${word}', ${hint}`);
  }
  return { target, command, options };
};

module.exports = parser;
