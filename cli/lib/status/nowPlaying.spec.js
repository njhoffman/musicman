const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { spotifyIdFrame } = require('../sync/match.js');
const { fieldValue, nowPlaying, statusFields } = require('./nowPlaying.js');
const { spotifyContextOf } = require('./context.js');

const config = {
  mpd: { baseDirectory: '/music' },
  stats: { multiFields: ['context', 'mood'] }
};

const player = (source, status) => ({
  source,
  name: source === 'mpd' ? 'MPD' : 'Spotify',
  state: async () => status
});

const meta = {
  rating: '4.5',
  grouping: 'Ambient.Artists',
  genre: '',
  context: 'Study, Relax,',
  mood: '',
  title: 'ignored'
};

describe('Now playing', () => {
  let db;
  beforeEach(() => {
    db = openDatabase(':memory:');
    db.prepare('INSERT INTO songs (id, path, mtime, size) VALUES (1, ?, 0, 0)').run('Rated/a.mp3');
    db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (1, ?, ?)').run(
      spotifyIdFrame,
      'track1'
    );
    db.prepare("INSERT INTO spotify_playlists (id, name) VALUES ('liked', 'Liked Songs')").run();
    db.prepare("INSERT INTO spotify_playlists (id, name) VALUES ('p1', 'Study')").run();
    db.prepare(
      "INSERT INTO spotify_playlist_tracks (playlist_id, track_id) VALUES ('p1', 'track1'), ('liked', 'track1')"
    ).run();
  });

  it('should list the base fields, then stats.multiFields, each once', () => {
    expect(statusFields(config)).to.deep.equal([
      'rating',
      'grouping',
      'genre',
      'year',
      'context',
      'mood'
    ]);
    expect(statusFields({ stats: { multiFields: ['genre'] } })).to.deep.equal([
      'rating',
      'grouping',
      'genre',
      'year'
    ]);
  });

  it('should split multi value fields and drop empty values', () => {
    expect(fieldValue('Study, Relax,', true)).to.deep.equal(['Study', 'Relax']);
    expect(fieldValue(' Ambient ', false)).to.equal('Ambient');
    expect(fieldValue('', false)).to.equal(null);
    expect(fieldValue(undefined, true)).to.equal(null);
  });

  it('should show an MPD song with its tags, Spotify playlists, and queue position', async () => {
    const mpd = player('mpd', {
      state: 'playing',
      volume: 40,
      shuffle: true,
      repeat: 'off',
      queue: { position: 12, length: 340 },
      track: {
        file: '/music/Rated/a.mp3',
        title: 'A',
        artist: 'X',
        album: 'Y',
        position: 5,
        duration: 100
      }
    });
    const status = await nowPlaying({
      config,
      players: [mpd],
      db,
      readSong: async () => meta
    });
    expect(status).to.deep.include({
      player: { source: 'mpd', name: 'MPD' },
      state: 'playing',
      volume: 40,
      shuffle: true,
      repeat: 'off',
      from: { type: 'queue', position: 12, length: 340 },
      others: []
    });
    expect(status.song).to.deep.equal({
      file: '/music/Rated/a.mp3',
      inLibrary: true,
      trackId: 'track1',
      fields: { rating: '4.5', grouping: 'Ambient.Artists', context: ['Study', 'Relax'] },
      playlists: ['Liked Songs', 'Study']
    });
  });

  it('should link a Spotify track to its library song and ask for its context', async () => {
    const spotify = player('spotify', {
      state: 'paused',
      volume: null,
      shuffle: false,
      repeat: 'track',
      track: { trackId: 'track1', title: 'A', artist: 'X', album: 'Y', position: 0, duration: 0 }
    });
    const status = await nowPlaying({
      config,
      players: [spotify, player('mpd', { state: 'paused', track: { file: '/m/b.mp3' } })],
      db,
      readSong: async file => (file === '/music/Rated/a.mp3' ? meta : null),
      contextOf: async () => ({ type: 'playlist', name: 'Study' })
    });
    expect(status.song.file).to.equal('/music/Rated/a.mp3');
    expect(status.song.playlists).to.deep.equal(['Liked Songs', 'Study']);
    expect(status.from).to.deep.equal({ type: 'playlist', name: 'Study' });
    expect(status.others).to.deep.equal([{ source: 'mpd', name: 'MPD', state: 'paused' }]);
  });

  it('should show a Spotify track that is not in the library, and survive a failing context', async () => {
    const spotify = player('spotify', {
      state: 'playing',
      track: { trackId: 'other', title: 'B', position: 1, duration: 2 }
    });
    const status = await nowPlaying({
      config,
      players: [spotify],
      db,
      readSong: async () => {
        throw new Error('should not read');
      },
      contextOf: async () => {
        throw new Error('no network');
      }
    });
    expect(status.song).to.deep.equal({
      file: null,
      inLibrary: false,
      trackId: 'other',
      fields: {},
      playlists: []
    });
    expect(status.from).to.equal(null);
  });

  it('should work without a library database', async () => {
    const mpd = player('mpd', { state: 'playing', track: { file: '/music/c.mp3', title: 'C' } });
    const status = await nowPlaying({
      config,
      players: [mpd],
      db: null,
      readSong: async () => meta
    });
    expect(status.song).to.include({ inLibrary: true, trackId: null });
    expect(status.song.playlists).to.deep.equal([]);
  });

  it('should report nothing playing, with no stopped players as others', async () => {
    const status = await nowPlaying({
      config,
      players: [
        player('mpd', { state: 'stopped', track: null }),
        player('spotify', { state: null })
      ],
      db,
      readSong: async () => null
    });
    expect(status).to.deep.equal({ player: null, others: [] });
  });
});

describe('Spotify context', () => {
  // a client answering GETs from routes by path prefix
  const client = routes => () => ({
    get: async url => {
      const route = Object.keys(routes).find(prefix => url.startsWith(prefix));
      return route ? routes[route] : null;
    }
  });
  const track = { trackId: 't1', album: 'Local Album' };
  const playing = context => ({ context, item: { id: 't1', album: { name: 'Album' } } });

  it('should name playlist, album, artist, and Liked Songs contexts', async () => {
    const routes = context => ({
      '/me/player': playing(context),
      '/playlists/p1': { name: 'Study' },
      '/artists/a1': { name: 'Mazzy Star' }
    });
    const of = context => spotifyContextOf(client(routes(context)))(track);
    expect(await of({ type: 'playlist', uri: 'spotify:playlist:p1' })).to.deep.equal({
      type: 'playlist',
      name: 'Study'
    });
    expect(await of({ type: 'album', uri: 'spotify:album:x' })).to.deep.equal({
      type: 'album',
      name: 'Album'
    });
    expect(await of({ type: 'artist', uri: 'spotify:artist:a1' })).to.deep.equal({
      type: 'artist',
      name: 'Mazzy Star'
    });
    expect(await of({ type: 'collection', uri: 'spotify:user:me:collection' })).to.deep.equal({
      type: 'collection',
      name: 'Liked Songs'
    });
  });

  it('should give null for a track list, another track, or no playback', async () => {
    expect(await spotifyContextOf(client({ '/me/player': playing(null) }))(track)).to.equal(null);
    const elsewhere = {
      context: { type: 'playlist', uri: 'spotify:playlist:p1' },
      item: { id: 't2' }
    };
    expect(await spotifyContextOf(client({ '/me/player': elsewhere }))(track)).to.equal(null);
    expect(await spotifyContextOf(client({}))(track)).to.equal(null);
  });
});
