const _ = require('lodash');
const chalk = require('chalk').default;

const { availableWidth, stripAnsi } = require('../utils/logger.js');
const { coloredCounts } = require('./progress.js');
const { renderColumns } = require('./render.js');

const statusColors = {
  match: '#55CC55',
  refresh: '#55BBDD',
  review: '#DDCC44',
  missing: '#DD7744',
  failed: '#DD4444'
};

const dim = chalk.hex('#888899');
const key = chalk.hex('#33CCAA');

// values longer than this are cut in the per-song field lines, the run log keeps the full lines
const maxValueWidth = 40;

const cut = (text, width = maxValueWidth) =>
  text.length > width ? `${text.slice(0, width - 1)}~` : text;

const songLabel = ({ song, file }) =>
  song && (song.artist || song.title) ? `${song.artist || '?'} - ${song.title || '?'}` : file;

const trackLabel = track =>
  track
    ? `${_.map(track.artists, 'name').join(', ')} - ${track.name} [${_.get(track, 'album.name')}]`
    : null;

const candidateLabel = candidate =>
  candidate && candidate.name
    ? `${candidate.artists} - ${candidate.name} [${candidate.album}]`
    : null;

// signed difference of the Spotify duration from the local one, e.g. +1.2s
const durationDiff = (song, durationMs) => {
  if (!song || !song.duration || !durationMs) {
    return null;
  }
  const diff = Math.round((durationMs / 1000 - song.duration) * 10) / 10;
  return `${diff > 0 ? '+' : ''}${diff === 0 ? '0.0' : diff.toFixed(1)}s`;
};

// name=value pairs wrapped to the terminal width under a label
const wrapPairs = (label, pairs, indent) => {
  const width = Math.min(availableWidth(), 160) - indent.length - 10;
  const lines = [];
  let line = '';
  _.each(pairs, pair => {
    if (line && stripAnsi(line).length + stripAnsi(pair).length + 2 > width) {
      lines.push(line);
      line = '';
    }
    line = line ? `${line}  ${pair}` : pair;
  });
  if (line) {
    lines.push(line);
  }
  return _.map(
    lines,
    (text, i) => `${indent}${i === 0 ? dim(label.padEnd(8)) : ' '.repeat(8)}${text}`
  );
};

// subtle counts of what was written to a song: custom fields, standard tags filled, and tags kept
const writeCounts = writes =>
  [
    chalk.hex('#55AA77')(`+${writes.custom.length} fields`),
    writes.filled.length > 0 && chalk.hex('#5599BB')(`~${writes.filled.length} filled`),
    writes.kept.length > 0 && chalk.hex('#777788')(`=${writes.kept.length} kept`)
  ]
    .filter(Boolean)
    .join(' ');

// field lines under a song for --verbose: custom fields written, standard tags filled, and kept
const writeLines = (writes, indent) => [
  ...wrapPairs(
    'fields',
    _.map(writes.custom, ({ name, value }) => `${key(name)}=${cut(`${value}`)}`),
    indent
  ),
  ...(writes.filled.length > 0
    ? wrapPairs(
        'filled',
        _.map(writes.filled, ({ name, value }) => `${key(name)}=${cut(`${value}`)}`),
        indent
      )
    : []),
  ...(writes.kept.length > 0 ? wrapPairs('kept', _.map(writes.kept, 'name'), indent) : [])
];

/**
 * Output for one song of sync --match: status (marked dry in a dry run), source, the local song, the
 * Spotify track it was matched to, and counts of the fields written, filled, and kept. verbose adds a
 * line per kind with every field and value.
 */
const formatSongResult = (status, item, result = {}, { verbose = false, dryRun = false } = {}) => {
  const color = chalk.hex(statusColors[status] || '#BBBBBB');
  const track = result.track || null;
  const target = trackLabel(track) || candidateLabel(result.candidate);
  const diff = durationDiff(
    item.song,
    track ? track.duration_ms : _.get(result, 'candidate.durationMs')
  );
  const { writes } = result;
  const indent = '  ';
  const head = [
    color(status.toUpperCase().padEnd(7)) + (dryRun ? chalk.hex('#777788').italic(' dry') : ''),
    dim((result.source || '').padEnd(6)),
    songLabel(item),
    target && `${dim('->')} ${target}`,
    diff && dim(`(${diff})`),
    writes && !verbose && writeCounts(writes),
    result.error && !verbose && chalk.hex(statusColors.failed)(result.error)
  ]
    .filter(Boolean)
    .join(' ');
  if (!verbose) {
    return head;
  }
  const lines = [head, ...(writes ? writeLines(writes, indent) : [])];
  if (result.error) {
    lines.push(`${indent}${dim('error'.padEnd(8))}${result.error}`);
  }
  return lines.join('\n');
};

// unassigned response paths with the number of songs that had them, most common first
const formatUnassigned = unassigned =>
  _.map(
    _.sortBy(_.toPairs(unassigned), ([, count]) => -count),
    ([fieldPath, count]) => `  ${fieldPath} (${count} ${count === 1 ? 'song' : 'songs'})`
  ).join('\n');

// counts for the sync --match status line, in the colors of the per-song statuses
const matchCounts = ({ match, refresh, review, missing, failed }) =>
  coloredCounts([
    [match, 'matched', statusColors.match],
    [refresh, 'refreshed', statusColors.refresh],
    [review, 'review', statusColors.review],
    [missing, 'missing', statusColors.missing],
    [failed, 'failed', statusColors.failed]
  ]);

const highlight = text => chalk.bold(key(text));

/**
 * The sync plan table, one row per target from columns ([key, header, value(target)]). Counts are right
 * aligned under their headers with a wide gutter, zeros are dimmed, and the columns whose keys are in
 * highlighted (what the command acts on, e.g. add for --push) are bold.
 */
const formatPlan = (plan, columns, highlighted = []) =>
  renderColumns({
    head: _.map(columns, 1),
    rows: _.map(plan, target => _.map(columns, ([, , value]) => String(value(target)))),
    splitter: '   ',
    columns: _.map(columns, ([name], i) => {
      if (i === 0) {
        return { maxWidth: 40 };
      }
      const strong = highlighted.includes(name);
      return {
        align: 'right',
        formatHeader: header => (strong ? highlight(header) : header),
        format: cell => (cell === '0' ? dim(cell) : strong ? highlight(cell) : cell)
      };
    })
  });

module.exports = {
  durationDiff,
  formatPlan,
  formatSongResult,
  formatUnassigned,
  highlight,
  matchCounts,
  statusColors
};
