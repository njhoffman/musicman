const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { spotifyIdFrame } = require('../sync/match.js');
const {
  cachedPlaylists,
  libraryFileForLocalTrack,
  libraryFileForPlaying,
  libraryFileForTrack,
  trackForLibraryFile
} = require('./library.js');

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
  describe('Spotify local files', () => {
    // songs with title, artist, album and length, as the database update stores them
    const addSong = (id, songPath, title, artist, album, duration) => {
      db.prepare('INSERT INTO songs (id, path, mtime, size, duration) VALUES (?, ?, 0, 0, ?)').run(
        id,
        songPath,
        duration
      );
      const tag = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)');
      tag.run(id, 'TIT2', title);
      tag.run(id, 'TPE1', artist);
      if (album) {
        tag.run(id, 'TALB', album);
      }
    };
    const local = {
      local: true,
      trackId: null,
      title: 'macquarie ridge',
      artist: 'Boards of Canada',
      album: 'The Campfire Headphase',
      duration: 297
    };

    beforeEach(() => {
      addSong(
        10,
        'Rated/BoC/Singles/Macquarie Ridge.mp3',
        'Macquarie Ridge',
        'Boards Of Canada',
        'Single',
        296.4
      );
      addSong(
        11,
        'Rated/BoC/Campfire/04 Macquarie Ridge.mp3',
        'Macquarie Ridge',
        'Boards of Canada',
        'The Campfire Headphase',
        297.2
      );
      addSong(12, 'Rated/Other/Macquarie Ridge.mp3', 'Macquarie Ridge', 'Someone Else', null, 297);
      addSong(
        13,
        'Rated/BoC/Live/Macquarie Ridge.mp3',
        'Macquarie Ridge',
        'Boards of Canada',
        'Live',
        340
      );
    });

    it('should find the song of a local file by title, artist and length, the same album first', () => {
      expect(libraryFileForLocalTrack(db, config, local)).to.equal(
        '/music/Rated/BoC/Campfire/04 Macquarie Ridge.mp3'
      );
      expect(libraryFileForLocalTrack(db, config, { ...local, album: 'Elsewhere' })).to.equal(
        '/music/Rated/BoC/Campfire/04 Macquarie Ridge.mp3'
      );
      expect(libraryFileForLocalTrack(db, config, { ...local, duration: 400 })).to.equal(null);
      expect(libraryFileForLocalTrack(db, config, { ...local, title: 'Dayvan Cowboy' })).to.equal(
        null
      );
    });

    it('should look up the playing track by player: MPD file, Spotify id, or local file', () => {
      expect(
        libraryFileForPlaying(db, config, { source: 'mpd' }, { file: '/music/x.mp3' })
      ).to.equal('/music/x.mp3');
      expect(
        libraryFileForPlaying(db, config, { source: 'spotify' }, { trackId: 'track1' })
      ).to.equal('/music/Rated/a.mp3');
      expect(libraryFileForPlaying(db, config, { source: 'spotify' }, local)).to.equal(
        '/music/Rated/BoC/Campfire/04 Macquarie Ridge.mp3'
      );
      expect(libraryFileForPlaying(null, config, { source: 'spotify' }, local)).to.equal(null);
      expect(libraryFileForPlaying(db, config, { source: 'spotify' }, null)).to.equal(null);
    });
  });
});
