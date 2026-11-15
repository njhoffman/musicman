const _ = require('lodash');
const path = require('path');

const { filterProblems } = require('musicman-common/config/validator.js');
const { reportErrors } = require('./common.js');
const { findSongs } = require('./search.js');
const playerCommand = require('./player.js');
const {
  checkName,
  findPreset,
  joinTerms,
  readPresets,
  smartFile,
  writePresets
} = require('../smart/presets.js');
const logger = require('../utils/logger.js');

const usage = [
  'musicman smart [--list] [--format tsv|json]   the smart playlists, with their song counts',
  '  musicman smart show NAME [--limit N] [--format tsv|json]',
  '  musicman smart save NAME TERMS...             add or replace one (search terms: field:value, text)',
  '  musicman smart rm NAME...',
  '  musicman smart NAME [--shuffle] [--main]      play it (player play: back returns to what played)'
].join('\n');

const formats = ['default', 'tsv', 'json'];

// a value for one tsv field: tabs and line breaks would split it
const tsvField = value => `${_.isNil(value) ? '' : value}`.replace(/[\t\r\n]+/g, ' ');
const tsv = rows => _.map(rows, row => `${_.map(row, tsvField).join('\t')}\n`).join('');

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Refuses terms whose field:value names a field that is not a library tag (or rating): search would
 * take it as free text and the playlist would quietly match something else. Free text words and mpc
 * style pairs pass.
 */
const checkTerms = (terms, config) => {
  if (terms.length === 0) {
    throw new Error('smart save needs search terms after the name, e.g. context:Study rating:4.5');
  }
  const fieldNames = new Set(_.map(_.get(config, 'library.tags'), 'name'));
  const filterLike = _.filter(terms, term => /^~?[\w-]+:/.test(term));
  const [problem] = filterProblems(filterLike, fieldNames);
  if (problem) {
    throw new Error(
      `Filter ${problem}: fields are rating, ${_.sortBy([...fieldNames]).join(', ')}`
    );
  }
};

// a song as smart show lists it, its file relative to the MPD music directory
const songRow = (config, [file, meta = {}]) => ({
  artist: meta.artist || '',
  title: meta.title || path.basename(file, path.extname(file)),
  rating: _.isNil(meta.rating) ? '' : String(meta.rating),
  file: path.relative(path.resolve(config.mpd.baseDirectory), file)
});

// the songs of a preset, with how many have a Spotify id
const presetSongs = async (preset, config, find) => {
  const songs = await find({ terms: preset.terms, config });
  return { songs, spotify: _.filter(songs, ([, meta]) => meta && meta.sp_track_id).length };
};

const listPresets = async ({ presets, config, find, format, out, file }) => {
  const rows = [];
  for (const preset of presets) {
    const { songs, spotify } = await presetSongs(preset, config, find);
    rows.push({ ...preset, text: joinTerms(preset.terms), songs: songs.length, spotify });
  }
  if (format === 'tsv') {
    out.write(tsv(_.map(rows, row => [row.name, row.text, row.songs, row.spotify])));
  } else if (format === 'json') {
    out.write(`${JSON.stringify(rows)}\n`);
  } else if (rows.length === 0) {
    logger.info(`No smart playlists yet (${file}): musicman smart save NAME TERMS...`);
  } else {
    const width = _.max(_.map(rows, row => row.name.length));
    _.each(rows, row =>
      logger.info(
        `${row.name.padEnd(width)}  ${row.text}  (${plural(row.songs, 'song')}, ${row.spotify} on Spotify)`
      )
    );
  }
  return rows;
};

const showPreset = async ({ preset, config, find, format, limit, out }) => {
  const { songs, spotify } = await presetSongs(preset, config, find);
  const tracks = _.map(_.isNumber(limit) ? _.take(songs, limit) : songs, song =>
    songRow(config, song)
  );
  const result = {
    name: preset.name,
    terms: preset.terms,
    songs: songs.length,
    spotify,
    tracks
  };
  if (format === 'tsv') {
    out.write(tsv(_.map(tracks, track => [track.artist, track.title, track.rating, track.file])));
  } else if (format === 'json') {
    out.write(`${JSON.stringify(result)}\n`);
  } else {
    logger.info(
      `${preset.name}: ${joinTerms(preset.terms)}  (${plural(songs.length, 'song')}, ${spotify} on Spotify)`
    );
    _.each(tracks, track =>
      logger.info(
        `  ${_.compact([track.artist, track.title]).join(' - ')}${track.rating ? `  ${track.rating}` : ''}`
      )
    );
    if (tracks.length < songs.length) {
      logger.info(`  ... ${songs.length - tracks.length} more`);
    }
  }
  return result;
};

/**
 * smart: named sets of search terms kept in smart.yml (lib/smart/presets.js) that play the library's
 * songs matching them now. Lists them with their counts, shows one's songs, saves (adds or replaces)
 * and removes them, and plays one through player play (--shuffle, --main as there). Dependencies
 * (tests): file (smart.yml), find (findSongs), player (the player command's run), out (stdout).
 */
const smartCommand = async ({
  options = {},
  config,
  env = process.env,
  file = smartFile(env),
  find = findSongs,
  player = playerCommand.run,
  out = process.stdout,
  ...rest
}) => {
  const switches = options.switches || {};
  const format = switches.format || 'default';
  if (!formats.includes(format)) {
    throw new Error(`smart prints ${formats.join(', ')}, not ${format}`);
  }
  const [action, ...args] = options.terms || [];
  const presets = readPresets(file);

  if (!action || action === 'list' || switches.list) {
    return listPresets({ presets, config, find, format, out, file });
  }
  if (action === 'show') {
    const limit = _.isNil(switches.limit) ? null : Number(switches.limit);
    if (!_.isNil(limit) && !(Number.isInteger(limit) && limit >= 0)) {
      throw new Error(`--limit takes a count of songs, not '${switches.limit}'`);
    }
    return showPreset({
      preset: findPreset(presets, args[0]),
      config,
      find,
      format,
      limit,
      out
    });
  }
  if (action === 'save') {
    const [name, ...terms] = args;
    checkName(name);
    checkTerms(terms, config);
    const exists = _.some(presets, { name });
    const saved = exists
      ? _.map(presets, preset => (preset.name === name ? { name, terms } : preset))
      : [...presets, { name, terms }];
    writePresets(file, saved);
    const { songs } = await presetSongs({ name, terms }, config, find);
    logger.info(
      `${exists ? 'Replaced' : 'Saved'} smart playlist ${name}: ${joinTerms(terms)} (${plural(songs.length, 'song')} now)`
    );
    return { name, terms, songs: songs.length, replaced: exists };
  }
  if (action === 'rm') {
    if (args.length === 0) {
      throw new Error('smart rm needs the names of the smart playlists to remove');
    }
    _.each(args, name => findPreset(presets, name));
    writePresets(
      file,
      _.reject(presets, ({ name }) => args.includes(name))
    );
    logger.info(`Removed ${plural(args.length, 'smart playlist')}: ${args.join(', ')}`);
    return { removed: args };
  }
  if (args.length > 0) {
    throw new Error(
      `smart ${action} takes no more words, did you mean musicman smart save?\n${usage}`
    );
  }
  const preset = findPreset(presets, action);
  return player({
    ...rest,
    options: {
      terms: ['play', ...preset.terms],
      switches: _.pick(switches, ['shuffle', 'main'])
    },
    config,
    env
  });
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'smart',
  // the terms are search terms (free text included) or a playlist's name, not view filters
  ownTerms: true,
  description:
    'Saved smart playlists (named search terms): list, show, save, remove, and play them',
  usage,
  switches: ['list', 'limit', 'format', 'shuffle', 'main'],
  switchHelp: {
    list: 'List the smart playlists with their song counts (also without any word)',
    limit: 'With show, list only the first N songs',
    format: 'With the list or show: tsv or json',
    shuffle: 'Play the smart playlist in random order',
    main: 'Play it as a new main list: player back forgets what played before'
  },
  completes: ['smart', 'filters'],
  words: ['list', 'show', 'save', 'rm'],
  func: reportErrors(smartCommand),
  run: smartCommand,
  defaultTarget,
  targetArgs: false,
  checkTerms
};
