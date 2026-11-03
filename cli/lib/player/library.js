const _ = require('lodash');
const path = require('path');

const { isLocalTrackOf } = require('../sync/localFiles.js');
const { spotifyIdFrame } = require('../sync/match.js');

/**
 * The library file (absolute) linked to a Spotify track id by its TXXX.sp_track_id tag, the first one when
 * several copies share it, or null.
 */
const libraryFileForTrack = (db, config, trackId) => {
  if (!trackId) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT s.path FROM song_tags t JOIN songs s ON s.id = t.song_id
       WHERE t.frame_id = ? AND t.value = ? ORDER BY s.path LIMIT 1`
    )
    .get(spotifyIdFrame, trackId);
  return row ? path.join(path.resolve(config.mpd.baseDirectory), row.path) : null;
};

/**
 * The library file (absolute) of a Spotify local file playing ({ title, artist, album, duration }): a
 * local track has no Spotify id, and Spotify names it by the file's tags, so the song with the same
 * title, artist, and length (within 2 seconds, as the export matches them), preferring the same album,
 * then the first by path; null when none matches.
 */
const libraryFileForLocalTrack = (db, config, track) => {
  if (!track || !track.title) {
    return null;
  }
  const rows = db
    .prepare(
      `SELECT s.path, s.duration, a.value AS artist, t.value AS title, al.value AS album
       FROM song_tags t
       JOIN songs s ON s.id = t.song_id
       JOIN song_tags a ON a.song_id = s.id AND a.frame_id = 'TPE1'
       LEFT JOIN song_tags al ON al.song_id = s.id AND al.frame_id = 'TALB'
       WHERE t.frame_id = 'TIT2' AND t.value = ? COLLATE NOCASE`
    )
    .all(`${track.title}`.trim());
  const playing = {
    artists: track.artist,
    name: track.title,
    duration_ms: track.duration ? track.duration * 1000 : null
  };
  const sameAlbum = row => _.toLower(row.album || '') === _.toLower(track.album || '');
  const match = _.sortBy(
    _.filter(rows, row => isLocalTrackOf(row, playing)),
    [row => (sameAlbum(row) ? 0 : 1), 'path']
  )[0];
  return match ? path.join(path.resolve(config.mpd.baseDirectory), match.path) : null;
};

/**
 * The library file of the track a player plays: MPD's own file, the one linked to a Spotify track id,
 * or for a Spotify local file the one with its tags (libraryFileForLocalTrack); null when none.
 */
const libraryFileForPlaying = (db, config, player, track) => {
  if (!track) {
    return null;
  }
  if (player.source === 'mpd') {
    return track.file || null;
  }
  if (!db) {
    return null;
  }
  return track.trackId
    ? libraryFileForTrack(db, config, track.trackId)
    : track.local
      ? libraryFileForLocalTrack(db, config, track)
      : null;
};

// the Spotify track id tagged on a library file (absolute path), or null
const trackForLibraryFile = (db, config, file) => {
  const relative = path.relative(path.resolve(config.mpd.baseDirectory), file);
  const row = db
    .prepare(
      `SELECT t.value FROM song_tags t JOIN songs s ON s.id = t.song_id
       WHERE s.path = ? AND t.frame_id = ? LIMIT 1`
    )
    .get(relative, spotifyIdFrame);
  return row ? row.value : null;
};

/**
 * The cached Spotify playlists (Liked Songs first, then by name) holding a track, as { id, name }; as
 * current as the last sync refreshed the cache.
 */
const cachedPlaylists = (db, trackId) =>
  trackId
    ? _.map(
        db
          .prepare(
            `SELECT DISTINCT p.id, p.name FROM spotify_playlist_tracks t
             JOIN spotify_playlists p ON p.id = t.playlist_id
             WHERE t.track_id = ? ORDER BY p.id = 'liked' DESC, p.name COLLATE NOCASE`
          )
          .all(trackId),
        ({ id, name }) => ({ id, name })
      )
    : [];

module.exports = {
  cachedPlaylists,
  libraryFileForLocalTrack,
  libraryFileForPlaying,
  libraryFileForTrack,
  trackForLibraryFile
};
