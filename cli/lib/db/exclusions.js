const _ = require('lodash');

/**
 * Songs taken out of the library while their files stay on disk (duplicate copies, check --fix): db
 * --update, the commands reading the library, and the drift check skip their paths, and sync removes
 * their Spotify tracks from the playlists instead of pulling them. A trashed copy is listed too, for its
 * Spotify track. Paths are relative to mpd.baseDirectory.
 */

// the excluded paths, a Set
const excludedPaths = db =>
  new Set(_.map(db.prepare('SELECT path FROM excluded_songs').all(), 'path'));

// the Spotify track of each excluded song, a Map of track id to its path
const excludedTracks = db =>
  new Map(
    _.map(
      db.prepare('SELECT track_id, path FROM excluded_songs WHERE track_id IS NOT NULL').all(),
      ({ track_id: trackId, path }) => [trackId, path]
    )
  );

// takes a song out of the library: listed as excluded (why, and the copy kept), its row removed
const excludeSong = (db, { path, trackId = null, kept = null, reason = null }) => {
  db.prepare(
    `INSERT INTO excluded_songs (path, track_id, kept, reason) VALUES (?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET track_id = excluded.track_id, kept = excluded.kept,
       reason = excluded.reason, excluded_at = datetime('now')`
  ).run(path, trackId, kept, reason);
  db.prepare('DELETE FROM songs WHERE path = ?').run(path);
};

// the exclusion of a path, null when it is not excluded
const exclusionOf = (db, path) => {
  const row = db.prepare('SELECT * FROM excluded_songs WHERE path = ?').get(path);
  return row ? { ...row } : null;
};

// lets an excluded path back in (db --update reads it again)
const includeSong = (db, path) =>
  db.prepare('DELETE FROM excluded_songs WHERE path = ?').run(path).changes > 0;

module.exports = { excludeSong, excludedPaths, excludedTracks, exclusionOf, includeSong };
