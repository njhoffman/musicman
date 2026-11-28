const _ = require('lodash');

/**
 * Songs musicman analyze failed on (the analysis_failures table): a file the script reports an error for,
 * or that its worker dies on, is recorded with the song's mtime and size at the time. After failureLimit
 * failures of the same file the song is skipped (skippedSql), until the file changes (db --update sees
 * another mtime or size), analyze --refresh, or an analysis that works (clearFailure). Paths are relative
 * to mpd.baseDirectory, as in the songs table.
 */
const failureLimit = 3;

// the condition, on songs s, of a song left out after failureLimit failures of its current file
const skippedSql = `EXISTS (
  SELECT 1 FROM analysis_failures f
  WHERE f.song_id = s.id AND f.count >= ${failureLimit} AND f.mtime = s.mtime AND f.size = s.size
)`;

// one more failure of the song at path; a file changed since the last failure starts again at 1. Returns
// the count, or null for a path not in the library
const recordFailure = (db, songPath, error) => {
  const song = db.prepare('SELECT id, mtime, size FROM songs WHERE path = ?').get(songPath);
  if (!song) {
    return null;
  }
  const previous = db
    .prepare('SELECT count, mtime, size FROM analysis_failures WHERE song_id = ?')
    .get(song.id);
  const count =
    previous && previous.mtime === song.mtime && previous.size === song.size
      ? previous.count + 1
      : 1;
  db.prepare(
    `INSERT INTO analysis_failures (song_id, mtime, size, count, error, failed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (song_id) DO UPDATE SET mtime = excluded.mtime, size = excluded.size,
       count = excluded.count, error = excluded.error, failed_at = excluded.failed_at`
  ).run(song.id, song.mtime, song.size, count, error);
  return count;
};

// an analysis of the song at path worked: its failures are forgotten
const clearFailure = (db, songPath) =>
  db
    .prepare('DELETE FROM analysis_failures WHERE song_id = (SELECT id FROM songs WHERE path = ?)')
    .run(songPath).changes > 0;

// the songs skipped now, [{ path, count, error, failedAt }], by path
const skippedSongs = db =>
  _.map(
    db
      .prepare(
        `SELECT s.path, f.count, f.error, f.failed_at FROM songs s
         JOIN analysis_failures f ON f.song_id = s.id
         WHERE ${skippedSql}
         ORDER BY s.path`
      )
      .all(),
    ({ path, count, error, failed_at: failedAt }) => ({ path, count, error, failedAt })
  );

module.exports = { clearFailure, failureLimit, recordFailure, skippedSongs, skippedSql };
