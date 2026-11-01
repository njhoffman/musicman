const _ = require('lodash');

const commands = require('../commands/index.js');
const switchMap = require('../parser/options/switchMap.js');
const globalSwitches = require('../parser/options/globalSwitches.js');
const { formats } = require('../output/formats.js');

/**
 * Shell-neutral description of the command line that completion scripts are rendered from.
 *
 *   switches: every switch by name, with its alias, description, and value: the placeholder, the words it
 *             completes, and the separator of a list of them (-i artist,title)
 *   commands: name, description, the switches it takes (global ones included), completes: the kinds of
 *             other arguments it takes (paths, filters as field:value, assignments as field=value,
 *             commands), and words: literal words it takes (latest)
 *   default:  the arguments without a command word, those of view and edit since the parser picks edit
 *             for an assignment; first: kinds completed only as the first word
 *   fields:   the field names filters, assignments, and -i/-x complete
 *   values:   where the values after field: and field= come from when completing: the library database
 *             (db), the frame of each field (frames, rating has steps instead), the rating steps, and
 *             the directory of archived runs whose ids undo and logs complete
 * A command's pairs ({ setting: [modes] }) are setting words each followed by one of its modes.
 *
 * tags are the library.tags ({ name, id }) and fields extra field names; db and runsDirectory are paths.
 */
const completionModel = ({
  fields = [],
  tags = [],
  db = null,
  runsDirectory = null,
  ratingMax = 5,
  shells = [],
  completionCommand
}) => {
  const fieldNames = _.uniq(['rating', ...fields, ..._.map(tags, 'name')]);
  // words a switch value completes, by its placeholder
  const valueWords = {
    format: { words: formats },
    fields: { words: fieldNames, separator: ',' }
  };
  const switches = _.mapValues(
    { ...switchMap, ...globalSwitches },
    ({ alias, description, value }, name) => ({
      name,
      alias,
      description,
      ...(value ? { value: { name: value, words: [], ...valueWords[value] } } : {})
    })
  );
  const globalNames = _.keys(globalSwitches);
  const commandModel = ({
    name,
    description,
    switches: names = [],
    completes = [],
    words = [],
    pairs = null
  }) => ({
    name,
    description,
    switches: _.union(names, globalNames),
    completes,
    words,
    ...(pairs ? { pairs } : {})
  });
  const commandModels = [
    ..._.map(commands, commandModel),
    commandModel({ ...completionCommand, words: shells })
  ];
  const named = name => _.find(commandModels, { name });

  return {
    program: 'musicman',
    switches,
    commands: commandModels,
    default: {
      switches: _.union(named('view').switches, named('edit').switches),
      completes: ['paths', 'filters', 'assignments'],
      first: ['commands']
    },
    fields: fieldNames,
    values: {
      db,
      frames: _.fromPairs(
        _.map(
          _.filter(tags, ({ name, id }) => name !== 'rating' && id),
          ({ name, id }) => [name, id]
        )
      ),
      ratings: _.range(1, Math.round(ratingMax * 2) + 1).map(step => String(step / 2)),
      runsDirectory
    }
  };
};

module.exports = { completionModel };
