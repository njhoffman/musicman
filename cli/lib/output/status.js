const _ = require('lodash');
const path = require('path');
const chalk = require('chalk').default;

const { accents, clock, icons: playerIcons } = require('../menu/menu.js');

// Nerd Font glyphs (Font Awesome code points) before each field, status.icons: false leaves them out
const fieldIcons = {
  rating: '',
  grouping: '',
  genre: '',
  year: '',
  context: '',
  mood: '',
  picks: '',
  playlists: '',
  from: '',
  file: '',
  volume: ''
};
const defaultFieldIcon = '';

const dim = text => chalk.hex('#888899')(text);

const stars = rating => {
  const value = Number(rating) || 0;
  return `${'★'.repeat(Math.floor(value))}${value % 1 ? '½' : ''}`;
};

/**
 * A progress bar of width characters for position of duration (seconds), with the times at both ends:
 * `1:23 ━━━━━━──────── 3:00`. Without a duration only the position is shown.
 */
const progressBar = (position, duration, width, color = text => text) => {
  if (!duration) {
    return clock(position);
  }
  const start = clock(position);
  const end = clock(duration);
  const length = Math.max(10, width - start.length - end.length - 2);
  const filled = Math.round(_.clamp(position / duration, 0, 1) * length);
  return `${start} ${color('━'.repeat(filled))}${dim('─'.repeat(length - filled))} ${end}`;
};

// where the song plays from, as text
const describeFrom = from => {
  if (!from) {
    return null;
  }
  if (from.type === 'queue') {
    return `queue ${from.position} of ${from.length}`;
  }
  return from.name ? `${from.type} "${from.name}"` : from.type;
};

const modeText = (label, value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const shown = _.isBoolean(value) ? (value ? 'on' : 'off') : value;
  return shown === 'off' ? dim(`${label} off`) : `${label} ${chalk.bold(shown)}`;
};

/**
 * The now playing screen for a nowPlaying status, as lines of text: the player and its modes, the song,
 * a progress bar, the library fields, the playlists holding the track, where it plays from, and the file.
 * width caps the progress bar; icons adds Nerd Font glyphs; files show relative to baseDirectory.
 */
const renderStatus = (status, { width = 80, icons = true, baseDirectory = null } = {}) => {
  if (!status.player) {
    const others = _.map(status.others, ({ name, state }) => `${name} ${state}`);
    return [`Nothing is playing${others.length ? ` (${others.join(', ')})` : ''}`];
  }
  const accent = chalk.hex(accents[status.player.source] || '#8888FF');
  const icon = name => (icons ? `${fieldIcons[name] || defaultFieldIcon} ` : '');
  const { track, song } = status;

  const header = _.compact([
    accent.bold(`${icons ? `${playerIcons[status.player.source]}  ` : ''}${status.player.name}`),
    `${status.state === 'playing' ? '▶' : '⏸'} ${status.state}`,
    _.isNil(status.volume) ? null : `${icon('volume')}${status.volume}%`,
    modeText(status.player.source === 'mpd' ? 'random' : 'shuffle', status.shuffle),
    modeText('repeat', status.repeat)
  ]).join('   ');

  const rows = [];
  const add = (name, value, label = name) => {
    if (value !== null && value !== undefined && !_.isEqual(value, [])) {
      rows.push([`${icon(name)}${label}`, value]);
    }
  };
  if (song.inLibrary) {
    const { rating, ...fields } = song.fields;
    add('rating', rating ? `${chalk.yellow(stars(rating))} ${rating}` : dim('unrated'));
    _.each(fields, (value, field) => add(field, _.isArray(value) ? value.join(', ') : value));
  }
  add('playlists', song.playlists.length ? song.playlists.join(', ') : null);
  add('from', describeFrom(status.from));
  add(
    'file',
    song.inLibrary
      ? dim(baseDirectory ? path.relative(baseDirectory, song.file) : song.file)
      : chalk.italic(dim('not in the library')),
    song.inLibrary ? 'file' : 'library'
  );
  const labelWidth = _.max(_.map(rows, ([label]) => label.length)) || 0;

  return [
    header,
    '',
    chalk.bold(track.title),
    _.compact([track.artist, track.album]).join(dim('  ·  ')),
    progressBar(track.position, track.duration, Math.min(width, 72), accent),
    '',
    ..._.map(rows, ([label, value]) => `${dim(label.padEnd(labelWidth))}  ${value}`),
    ...(status.others.length
      ? [
          '',
          dim(`also ${_.map(status.others, ({ name, state }) => `${name} ${state}`).join(', ')}`)
        ]
      : [])
  ];
};

module.exports = { describeFrom, progressBar, renderStatus, stars };
