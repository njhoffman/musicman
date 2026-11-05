const _ = require('lodash');

const { choosePlayer } = require('../player/players.js');
const {
  cachedLocalPlaylists,
  cachedPlaylists,
  libraryFileForPlaying,
  trackForLibraryFile
} = require('../player/library.js');

// tag fields shown for a library song before the multi value fields of stats.multiFields
const baseFields = ['rating', 'grouping', 'genre', 'year'];

// the fields shown for a song: the base ones, then stats.multiFields, each once
const statusFields = config => _.uniq([...baseFields, ..._.get(config, 'stats.multiFields', [])]);

// a field value as a list for multi value fields (comma separated, empty items dropped), else a string
const fieldValue = (value, multi) => {
  if (value === undefined || value === null || `${value}`.trim() === '') {
    return null;
  }
  return multi ? _.compact(_.map(`${value}`.split(','), _.trim)) : `${value}`.trim();
};

/**
 * The library side of the playing track: its file (MPD's, the one linked to the Spotify track, or the
 * one a Spotify local file was made from), its Spotify id, its status fields, and the cached playlists
 * holding it. db is null without a library database, which leaves only the file of an MPD song.
 */
const librarySong = async ({ config, db, readSong, player, track }) => {
  const file = libraryFileForPlaying(db, config, player, track);
  const trackId =
    player.source === 'spotify'
      ? track.trackId
      : db && file
        ? trackForLibraryFile(db, config, file)
        : null;
  const meta = file ? (await readSong(file)) || {} : null;
  const multi = new Set(_.get(config, 'stats.multiFields', []));
  const fields = meta
    ? _.pickBy(
        _.fromPairs(
          _.map(statusFields(config), field => [field, fieldValue(meta[field], multi.has(field))])
        ),
        value => value !== null && !_.isEqual(value, [])
      )
    : {};
  return {
    file: file || null,
    inLibrary: Boolean(meta),
    trackId: trackId || null,
    fields,
    playlists: db
      ? _.uniq([
          ..._.map(cachedPlaylists(db, trackId), 'name'),
          // a track without its own id may also be a local file in a playlist
          ..._.map(track.trackId ? [] : cachedLocalPlaylists(db, track), 'name')
        ])
      : []
  };
};

/**
 * What is playing: the player the status shows (the one playing, Spotify when both are, else a paused
 * one), its state and modes, the track, its library song, the cached playlists holding it, and where it
 * plays from (the MPD queue position, or the Spotify context from contextOf). others are the other
 * players playing or paused. Resolves to { player: null, others } when nothing is playing or paused.
 * Dependencies: players, db (null without a library database), readSong(file) the parsed tags of a file,
 * contextOf(track) (optional) the Spotify context as { type, name } or null.
 */
const nowPlaying = async ({ config, players, db = null, readSong, contextOf = null }) => {
  const { active, all } = await choosePlayer(players);
  const others = _.map(
    _.filter(
      all,
      ({ player, status }) =>
        ['playing', 'paused'].includes(status.state) && (!active || player !== active.player)
    ),
    ({ player, status }) => ({ source: player.source, name: player.name, state: status.state })
  );
  if (!active || !active.status.track) {
    return { player: null, others };
  }
  const { player, status } = active;
  const { track } = status;
  const song = await librarySong({ config, db, readSong, player, track });
  let from = null;
  if (player.source === 'mpd' && status.queue && status.queue.position) {
    from = { type: 'queue', position: status.queue.position, length: status.queue.length };
  } else if (player.source === 'spotify' && contextOf) {
    from = await contextOf(track).catch(() => null);
  }
  return {
    player: { source: player.source, name: player.name },
    state: status.state,
    volume: _.isNil(status.volume) ? null : status.volume,
    shuffle: _.isBoolean(status.shuffle) ? status.shuffle : null,
    repeat: status.repeat || null,
    track: _.pick(track, ['title', 'artist', 'album', 'position', 'duration', 'trackId']),
    song,
    from,
    others
  };
};

module.exports = { fieldValue, nowPlaying, statusFields };
