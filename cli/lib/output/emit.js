const _ = require('lodash');
const chalk = require('chalk').default;

const { formatRecords, formatSections, outputFormat } = require('./formats.js');
const { pickWithFzf } = require('./fzf.js');

const dim = text => chalk.hex('#888899')(text);

// oneline output is colored even when piped (to fzf, usually), unless NO_COLOR is set; log messages
// keep the color level of the terminal
const withColors = (format, fn) => {
  const { level } = chalk;
  if (format === 'oneline' && level === 0 && !process.env.NO_COLOR) {
    chalk.level = 3;
  }
  try {
    return fn();
  } finally {
    chalk.level = level;
  }
};

const ratingText = (rating, config) =>
  _.isEmpty(rating) ? dim('-.-') : chalk.hex(_.get(config, 'rating.color', '#BBDDFF'))(rating);

// view table tags, after --include or --exclude
const songColumns = (config, { include = [], exclude = [] } = {}) => {
  const names = _.map(_.get(config, 'views.table.tags'), 'name');
  return include.length > 0
    ? _.filter(names, name => include.includes(name))
    : _.difference(names, exclude);
};

// { path, ...view tags } for [file, meta] pairs
const songRecords = (pairs, columns) =>
  _.map(pairs, ([file, meta]) => ({ path: file, ..._.pick(meta, columns) }));

// path<TAB>rating artist - title [album] and the other tag values, for fzf
const songOneline = config => record => {
  const rest = _.compact(
    _.map(_.omit(record, ['path', 'rating', 'artist', 'title', 'album']), value =>
      _.isNil(value) ? '' : String(value)
    )
  );
  return [
    record.path,
    [
      ratingText(record.rating, config),
      `${chalk.bold(record.artist || '?')} - ${record.title || '?'}`,
      record.album ? dim(`[${record.album}]`) : '',
      rest.length > 0 ? dim(rest.join('  ')) : ''
    ]
      .filter(Boolean)
      .join(' ')
  ].join('\t');
};

/**
 * Writes records (or sections of records) in the --format of the switches, or lets the user pick
 * oneline lines with --fzf and writes the picked keys, one per line. Returns { format, selected } with
 * the picked keys for --fzf. Only called for formats other than default.
 */
const emitFormatted = ({
  switches = {},
  config,
  title,
  records,
  columns,
  sections,
  oneline,
  preview,
  previewWindow,
  header,
  pick = pickWithFzf,
  write = text => process.stdout.write(text)
}) => {
  const format = outputFormat(switches);
  const options = { format, title, oneline, delimiter: _.get(config, 'delimiter', ',') };
  const text = withColors(format, () =>
    sections
      ? formatSections({ ...options, sections })
      : formatRecords({ ...options, records, columns })
  );
  if (switches.fzf) {
    const selected = pick(text ? text.split('\n') : [], {
      preview,
      prompt: title,
      ...(header ? { header } : {}),
      ...(previewWindow ? { previewWindow } : {})
    });
    if (selected.length > 0) {
      write(`${selected.join('\n')}\n`);
    }
    return { format, selected };
  }
  write(text ? `${text}\n` : '');
  return { format };
};

module.exports = { dim, emitFormatted, ratingText, songColumns, songOneline, songRecords };
