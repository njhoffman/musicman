const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { pushSong } = require('./song.js');

describe('Sync One Song', () => {
  const study = 'StudyPlaylist000000000';
  const run = 'RunPlaylist00000000000';
  const config = {
    mpd: { baseDirectory: '/music' },
    library: { tags: [{ name: 'context', id: 'TXXX.context', multi: true }] },
    sync: {
      likedRating: 4.5,
      playlists: [
        { filter: 'context:Study', playlist: study },
        { filter: 'context:Run', playlist: run }
      ]
    }
  };
  let db;

  const addSong = (file, trackId) => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)')
      .run(file);
    db.prepare(
      "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', ?)"
    ).run(lastInsertRowid, trackId);
  };
  const cache = (playlistId, trackIds, snapshotId = 's1') => {
    db.prepare(
      'INSERT OR REPLACE INTO spotify_playlists (id, name, snapshot_id) VALUES (?, ?, ?)'
    ).run(playlistId, `Playlist ${playlistId}`, snapshotId);
    trackIds.forEach(trackId =>
      db
        .prepare('INSERT INTO spotify_playlist_tracks (playlist_id, track_id) VALUES (?, ?)')
        .run(playlistId, trackId)
    );
  };
  const tracksIn = playlistId =>
    db
      .prepare('SELECT track_id FROM spotify_playlist_tracks WHERE playlist_id = ?')
      .all(playlistId)
      .map(row => row.track_id);
  const synced = playlistId =>
    db
      .prepare('SELECT track_id FROM spotify_synced WHERE playlist_id = ?')
      .all(playlistId)
      .map(row => row.track_id);

  // a client whose playlists keep the cached snapshot, so refreshing them fetches nothing
  const client = () => {
    const requests = [];
    return {
      requests,
      get: async url => ({ name: 'x', snapshot_id: 's1', url }),
      paginate: async () => {
        throw new Error('the playlist should not be fetched again');
      },
      request: async (method, url, body) => {
        requests.push([method, url, body]);
        return null;
      }
    };
  };
  const push = (spotify, before, after, readSongs = async () => []) =>
    pushSong({ db, client: spotify, config, file: '/music/a.mp3', before, after, readSongs });

  beforeEach(() => {
    db = openDatabase(':memory:');
    addSong('a.mp3', 'ta');
    cache(study, []);
    cache(run, ['ta']);
    cache('liked', []);
  });

  afterEach(() => {
    db.close();
  });

  it('should add the track to the playlist of a tag that was added, and record it as synced', async () => {
    const spotify = client();
    const results = await push(
      spotify,
      { rating: '4.0', context: 'Run' },
      { rating: '4.0', context: 'Run,Study' }
    );
    expect(spotify.requests).to.deep.equal([
      ['POST', `/playlists/${study}/items`, { uris: ['spotify:track:ta'] }]
    ]);
    expect(results).to.deep.equal([{ id: study, name: `Playlist ${study}`, action: 'add' }]);
    expect(tracksIn(study)).to.deep.equal(['ta']);
    expect(synced(study)).to.deep.equal(['ta']);
  });

  it('should remove the track from the playlist of a tag that was removed', async () => {
    db.prepare('INSERT INTO spotify_synced (playlist_id, track_id) VALUES (?, ?)').run(run, 'ta');
    const spotify = client();
    await push(spotify, { rating: '4.0', context: 'Run' }, { rating: '4.0', context: '' });
    expect(spotify.requests).to.deep.equal([
      ['DELETE', `/playlists/${run}/items`, { items: [{ uri: 'spotify:track:ta' }] }]
    ]);
    expect(tracksIn(run)).to.be.empty;
    expect(synced(run)).to.be.empty;
  });

  it('should not add a track the refreshed playlist already has', async () => {
    db.prepare('INSERT INTO spotify_playlist_tracks (playlist_id, track_id) VALUES (?, ?)').run(
      study,
      'ta'
    );
    const spotify = client();
    const results = await push(spotify, { context: 'Run' }, { context: 'Run,Study' });
    expect(spotify.requests).to.be.empty;
    expect(results).to.be.empty;
    expect(synced(study)).to.deep.equal(['ta']);
  });

  it('should keep the track where another copy of the song still belongs', async () => {
    addSong('copy.mp3', 'ta');
    const spotify = client();
    const readSongs = async files => files.map(file => [file, { context: 'Run' }]);
    await push(spotify, { context: 'Run' }, { context: '' }, readSongs);
    expect(spotify.requests).to.be.empty;
    expect(tracksIn(run)).to.deep.equal(['ta']);
  });

  it('should save the track to Liked Songs when its rating reaches sync.likedRating', async () => {
    const spotify = client();
    await push(spotify, { rating: '4.0', context: 'Run' }, { rating: '4.5', context: 'Run' });
    expect(spotify.requests).to.deep.equal([['PUT', '/me/tracks', { ids: ['ta'] }]]);
    expect(tracksIn('liked')).to.deep.equal(['ta']);
  });

  it('should leave songs without a Spotify id or outside sync.scope alone', async () => {
    const spotify = client();
    const none = await pushSong({
      db,
      client: spotify,
      config,
      file: '/music/other.mp3',
      before: {},
      after: { context: 'Study' },
      readSongs: async () => []
    });
    expect(none).to.be.empty;
    const scoped = { ...config, sync: { ...config.sync, scope: 'rating:4' } };
    const outside = await pushSong({
      db,
      client: spotify,
      config: scoped,
      file: '/music/a.mp3',
      before: { rating: '3.0' },
      after: { rating: '3.0', context: 'Study' },
      readSongs: async () => []
    });
    expect(outside).to.be.empty;
    expect(spotify.requests).to.be.empty;
  });
});
