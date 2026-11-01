const _ = require('lodash');
const path = require('path');

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

module.exports = { cachedPlaylists, libraryFileForTrack, trackForLibraryFile };
