const _ = require('lodash');
const chalk = require('chalk').default;

const { availableWidth, stripAnsi } = require('../utils/logger.js');

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

/**
 * Lines for one song of sync --match: status, source, the local song and the Spotify track it was
 * matched to, then the custom fields written, the standard tags filled, and the ones kept.
 */
const formatSongResult = (status, item, result = {}) => {
  const color = chalk.hex(statusColors[status] || '#BBBBBB');
  const track = result.track || null;
  const target = trackLabel(track) || candidateLabel(result.candidate);
  const diff = durationDiff(
    item.song,
    track ? track.duration_ms : _.get(result, 'candidate.durationMs')
  );
  const head = [
    color(status.toUpperCase().padEnd(7)),
    dim((result.source || '').padEnd(6)),
    songLabel(item),
    target && `${dim('->')} ${target}`,
    diff && dim(`(${diff})`)
  ]
    .filter(Boolean)
    .join(' ');
  const indent = '  ';
  const lines = [head];
  const { writes } = result;
  if (writes) {
    lines.push(
      ...wrapPairs(
        'fields',
        _.map(writes.custom, ({ name, value }) => `${key(name)}=${cut(`${value}`)}`),
        indent
      )
    );
    if (writes.filled.length > 0) {
      lines.push(
        ...wrapPairs(
          'filled',
          _.map(writes.filled, ({ name, value }) => `${key(name)}=${cut(`${value}`)}`),
          indent
        )
      );
    }
    if (writes.kept.length > 0) {
      lines.push(...wrapPairs('kept', _.map(writes.kept, 'name'), indent));
    }
  }
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

module.exports = { durationDiff, formatSongResult, formatUnassigned };
