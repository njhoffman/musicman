// schema migrations, applied in order; PRAGMA user_version is the number already applied
// 1: songs, song_tags, tags, meta
// 2: spotify_matches (lookup results per song), spotify_playlists and spotify_playlist_tracks (cache)
// 3: spotify_synced (the tracks each target and the local tags last agreed on)
// 4: spotify_matches.reviewed_at (a match accepted in review) and .rejected (track ids rejected in review)
// 5: history_runs, tag_changes, spotify_changes (what each run changed, for musicman undo)
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
  `,
  `
  CREATE TABLE spotify_matches (
    song_id INTEGER PRIMARY KEY REFERENCES songs (id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    track_id TEXT,
    source TEXT,
    candidate TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE spotify_playlists (
    id TEXT PRIMARY KEY,
    name TEXT,
    snapshot_id TEXT,
    synced_at TEXT
  );

  CREATE TABLE spotify_playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES spotify_playlists (id) ON DELETE CASCADE,
    track_id TEXT,
    is_local INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    artists TEXT,
    album TEXT,
    duration_ms INTEGER,
    added_at TEXT
  );
  CREATE INDEX spotify_playlist_tracks_playlist ON spotify_playlist_tracks (playlist_id);
  CREATE INDEX spotify_playlist_tracks_track ON spotify_playlist_tracks (track_id);
  `,
  `
  CREATE TABLE spotify_synced (
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (playlist_id, track_id)
  );
  `,
  `
  ALTER TABLE spotify_matches ADD COLUMN reviewed_at TEXT;
  ALTER TABLE spotify_matches ADD COLUMN rejected TEXT;
  `,
  `
  CREATE TABLE history_runs (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    args TEXT,
    started_at TEXT NOT NULL,
    spotify_snapshot TEXT,
    undoes TEXT,
    undone_by TEXT
  );

  CREATE TABLE tag_changes (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES history_runs (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    frame TEXT NOT NULL,
    before TEXT,
    after_hash TEXT
  );
  CREATE INDEX tag_changes_run ON tag_changes (run_id);

  CREATE TABLE spotify_changes (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES history_runs (id) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    target_name TEXT,
    action TEXT NOT NULL,
    track_id TEXT NOT NULL
  );
  CREATE INDEX spotify_changes_run ON spotify_changes (run_id);
  `
];
