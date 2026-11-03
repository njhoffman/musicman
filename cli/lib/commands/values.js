const _ = require('lodash');
const chalk = require('chalk').default;
const fs = require('fs');

const { openLibrary } = require('../db/index.js');
const { emitFormatted } = require('../output/emit.js');
const { outputFormat } = require('../output/formats.js');
const logger = require('../utils/logger.js');

const dim = text => chalk.hex('#888899')(text);

// the fields listed when none are named: the tags submenu's multi value fields
const defaultFields = config => _.get(config, 'menu.tagFields', []);

/**
 * { name, frameId } for each field name, matched case-insensitively against library.tags; throws on a
 * name that is not a library tag, listing the multi value ones.
 */
const resolveFields = (names, config) => {
  const tags = _.get(config, 'library.tags', []);
  const byName = _.keyBy(tags, ({ name }) => name.toLowerCase());
  return _.map(names, name => {
    const tag = byName[name.toLowerCase()];
    if (!tag) {
      const multi = _.map(_.filter(tags, 'multi'), 'name').join(', ');
      throw new Error(
        `musicman values: '${name}' is not a library tag (multi value ones: ${multi})`
      );
    }
    return { name: tag.name, frameId: tag.id };
  });
};

/**
 * Values of each field in the library database with the number of songs that have them, most used first
 * (then by value): { field: [{ value, count }] }. Comma-joined values count as their parts, once per song.
 */
const fieldValues = (db, fields) => {
  const query = db.prepare('SELECT song_id, value FROM song_tags WHERE frame_id = ?');
  return _.fromPairs(
    _.map(fields, ({ name, frameId }) => {
      const songs = {};
      _.each(query.all(frameId), ({ song_id: songId, value }) => {
        String(value)
          .split(',')
          .map(part => part.trim())
          .filter(Boolean)
          .forEach(part => {
            (songs[part] = songs[part] || new Set()).add(songId);
          });
      });
      const counts = _.map(songs, (ids, value) => ({ value, count: ids.size }));
      return [name, _.orderBy(counts, ['count', 'value'], ['desc', 'asc'])];
    })
  );
};

// field:value<TAB>field value count, for fzf
const valuesOneline = record =>
  `${record.section}:${record.value}\t${chalk.hex('#8888FF')(record.section.padEnd(10))} ${
    record.value
  } ${dim(record.count)}`;

const outputValues = (values, write) => {
  _.each(values, (records, field) => {
    write(`${chalk.bold(field)}\n`);
    const width = _.max(_.map(records, ({ value }) => value.length)) || 0;
    _.each(records, ({ value, count }) => write(`  ${value.padEnd(width)}  ${dim(count)}\n`));
  });
};

const valuesCommand = async ({
  options,
  config,
  open = openLibrary,
  write = text => process.stdout.write(text)
}) => {
  const names = options.terms.length > 0 ? options.terms : defaultFields(config);
  let fields;
  try {
    fields = resolveFields(names, config);
  } catch (err) {
    logger.error(err.message);
    process.exitCode = 1;
    return { values: null };
  }
  const dbPath = config.db.path;
  if (open === openLibrary && !fs.existsSync(dbPath)) {
    logger.error(
      `musicman values: no library database at ${dbPath} (musicman db --update makes it)`
    );
    process.exitCode = 1;
    return { values: null };
  }
  const db = open(config);
  let values;
  try {
    values = fieldValues(db, fields);
  } finally {
    db.close();
  }
  if (outputFormat(options.switches) !== 'default') {
    const { selected } = emitFormatted({
      switches: options.switches,
      config,
      title: `musicman values ${_.map(fields, 'name').join(' ')}`,
      sections: _.map(values, (records, heading) => ({
        heading,
        columns: ['value', 'count'],
        records
      })),
      oneline: valuesOneline,
      write
    });
    return { values, selected };
  }
  outputValues(values, write);
  return { values };
};

module.exports = {
  name: 'values',
  description: 'List the values of fields in the library with their song counts, most used first',
  usage: 'musicman values [field ...] [--format=<format> | --fzf]',
  switches: ['format', 'fzf'],
  completes: [],
  func: valuesCommand,
  defaultTarget: baseDirectory => baseDirectory,
  targetArgs: false,
  fieldValues,
  resolveFields
};
