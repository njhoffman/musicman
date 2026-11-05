const _ = require('lodash');

// Nerd Font glyphs; the heart stays the color emoji the bar has always shown, colors do not apply to it
const glyphs = {
  spotify: '',
  mpd: '',
  heart: '\u{1FA77}',
  starFilled: '',
  starOutline: '',
  pause: ''
};

// what config.bar leaves out
const barDefaults = {
  enabled: true,
  maxLength: 60,
  colors: {
    spotify: '#1db954',
    mpd: '#7aa2f7',
    text: '#9aa5ce',
    paused: '#666666',
    time: '#777777',
    unrated: '#555555',
    low: '#666666',
    star: '#c0caf5',
    gold: '#ffd700'
  }
};

const barSettings = config => _.merge({}, barDefaults, _.get(config, 'bar'));

const paint = (color, text) => `%{F${color}}${text}%{F-}`;

/**
 * The one star of a song: nothing outside the library; in it, a gray filled star when unrated, a dim
 * outline below 4.0, a bright outline from 4.0, a bright filled star from 4.5, and a gold one at 5.0.
 */
const starOf = ({ inLibrary, rating }, colors) => {
  if (!inLibrary) {
    return '';
  }
  const value = Number(rating);
  if (!value) {
    return paint(colors.unrated, glyphs.starFilled);
  }
  if (value >= 5) {
    return paint(colors.gold, glyphs.starFilled);
  }
  if (value >= 4.5) {
    return paint(colors.star, glyphs.starFilled);
  }
  return paint(value >= 4 ? colors.star : colors.low, glyphs.starOutline);
};

// seconds left as -m:ss (-h:mm:ss from an hour), or '' for a track of unknown length
const formatRemaining = seconds => {
  if (_.isNil(seconds)) {
    return '';
  }
  const left = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(left / 60);
  const secs = _.padStart(`${left % 60}`, 2, '0');
  return minutes >= 60
    ? `-${Math.floor(minutes / 60)}:${_.padStart(`${minutes % 60}`, 2, '0')}:${secs}`
    : `-${minutes}:${secs}`;
};

/**
 * Song text on one line, cut to length; "%{" would start a polybar formatting tag, so a song name could
 * otherwise recolor the bar or bind a command to a click, and it gets a space.
 */
const barText = (text, length) =>
  _.truncate(_.trim(`${text}`.replace(/\s+/g, ' ')), { length, omission: '…' }).replace(
    /%\{/g,
    '% {'
  );

/**
 * The polybar line of a track: its player, the heart when in Liked Songs, the library star, a pause
 * glyph when paused, the title and artist, and the time left.
 * view: { source, state, title, artist, remaining, liked, inLibrary, rating }; null renders nothing.
 */
const renderBar = (view, config) => {
  if (!view) {
    return '';
  }
  const { colors, maxLength } = barSettings(config);
  const paused = view.state === 'paused';
  const name = _.compact([view.title, view.artist]).join(' - ');
  const time = formatRemaining(view.remaining);
  return _.compact([
    paint(colors[view.source], glyphs[view.source]),
    view.liked ? glyphs.heart : '',
    starOf(view, colors),
    paused ? paint(colors.paused, glyphs.pause) : '',
    paint(paused ? colors.paused : colors.text, barText(name, maxLength)),
    time ? paint(colors.time, time) : ''
  ]).join(' ');
};

module.exports = { barDefaults, barSettings, barText, formatRemaining, glyphs, renderBar, starOf };
