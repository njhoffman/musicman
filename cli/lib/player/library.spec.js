const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { spotifyIdFrame } = require('../sync/match.js');
const { cachedPlaylists, libraryFileForTrack, trackForLibraryFile } = require('./library.js');

describe('Player library lookups', () => {
  const config = { mpd: { baseDirectory: '/music' } };
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const song = db.prepare('INSERT INTO songs (id, path, mtime, size) VALUES (?, ?, 0, 0)');
    const tag = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)');
    song.run(1, 'Rated/b copy.mp3');
    song.run(2, 'Rated/a.mp3');
    song.run(3, 'Rated/other.mp3');
    tag.run(1, spotifyIdFrame, 'track1');
    tag.run(2, spotifyIdFrame, 'track1');
    tag.run(3, 'TIT2', 'track1');
    const playlist = db.prepare('INSERT INTO spotify_playlists (id, name) VALUES (?, ?)');
    const item = db.prepare(
      'INSERT INTO spotify_playlist_tracks (playlist_id, track_id) VALUES (?, ?)'
    );
    playlist.run('p2', 'study');
    playlist.run('p1', 'Nick’s Picks');
    playlist.run('liked', 'Liked Songs');
    playlist.run('p3', 'Unrelated');
    item.run('p2', 'track1');
    item.run('p1', 'track1');
    item.run('p1', 'track1');
    item.run('liked', 'track1');
    item.run('p3', 'track2');
  });

  it('should find the library file of a Spotify track, the first by path for copies', () => {
    expect(libraryFileForTrack(db, config, 'track1')).to.equal('/music/Rated/a.mp3');
    expect(libraryFileForTrack(db, config, 'missing')).to.equal(null);
    expect(libraryFileForTrack(db, config, null)).to.equal(null);
  });

  it('should find the Spotify track of a library file, only by its Spotify id frame', () => {
    expect(trackForLibraryFile(db, config, '/music/Rated/a.mp3')).to.equal('track1');
    expect(trackForLibraryFile(db, config, '/music/Rated/other.mp3')).to.equal(null);
  });

  it('should list the cached playlists of a track once each, Liked Songs first', () => {
    expect(cachedPlaylists(db, 'track1')).to.deep.equal([
      { id: 'liked', name: 'Liked Songs' },
      { id: 'p1', name: 'Nick’s Picks' },
      { id: 'p2', name: 'study' }
    ]);
    expect(cachedPlaylists(db, null)).to.deep.equal([]);
  });
});
