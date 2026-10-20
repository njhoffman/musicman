// schema migrations, applied in order; PRAGMA user_version is the number already applied
module.exports = [
  `
  CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    mb_track_id TEXT,
    mtime INTEGER NOT NULL,
    size INTEGER NOT NULL,
    duration REAL,
    rating REAL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX songs_mb_track_id ON songs (mb_track_id);

  CREATE TABLE song_tags (
    song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    frame_id TEXT NOT NULL,
    value TEXT NOT NULL
  );
  CREATE INDEX song_tags_song_id ON song_tags (song_id);
  CREATE INDEX song_tags_frame_value ON song_tags (frame_id, value);

  CREATE TABLE tags (
    name TEXT PRIMARY KEY,
    frame_id TEXT NOT NULL,
    multi INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `
];
