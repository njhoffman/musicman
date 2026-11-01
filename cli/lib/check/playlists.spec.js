const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { withScope } = require('./library.js');
const { exclusive, exclusiveGroups } = require('./playlists.js');

const ids = {
  r4: '0000000000000000000004',
  r5: '0000000000000000000005',
  indie: '000000000000000000000i',
  folk: '000000000000000000000f',
  study: '000000000000000000000s'
};
const url = id => `https://open.spotify.com/playlist/${id}`;

describe('Playlist checks', () => {
  let db;
  const config = {
    mpd: { baseDirectory: '/music' },
    rating: { tag: 'POPM', max: 5 },
    library: {
      tags: [
        { name: 'grouping', id: 'TIT1' },
        { name: 'context', id: 'TXXX.Context', multi: true }
      ]
    },
    tags: [],
    sync: {
      playlists: [
        { filter: 'rating:4.0-4.0', playlist: url(ids.r4) },
        { filter: 'rating:5.0-5.0', playlist: url(ids.r5) },
        { filter: 'grouping:IndieRock.Artists', playlist: url(ids.indie) },
        { filter: 'grouping:IndieRock.Singles', playlist: url(ids.indie) },
        { filter: 'grouping:FolkRock.Artists', playlist: url(ids.folk) },
        { filter: 'context:Study', playlist: url(ids.study) },
        { filter: 'rating:4 context:Study', playlist: url(ids.study) }
      ]
    }
  };
  const popm = stars =>
    JSON.stringify({ email: 'Default', rating: Math.round((stars * 255) / 5), counter: 0 });

  const addSong = (file, frames) => {
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO songs (path, mtime, size, duration) VALUES (?, 1, 1, 200)')
      .run(file);
    const insert = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)');
    Object.entries(frames).forEach(([frame, value]) =>
      [].concat(value).forEach(item => insert.run(id, frame, item))
    );
  };
  const onSpotify = (playlist, trackId, name) =>
    db
      .prepare(
        `INSERT INTO spotify_playlist_tracks (playlist_id, track_id, name, artists)
         VALUES (?, ?, ?, 'Band')`
      )
      .run(playlist, trackId, name);
  const check = (paths = null) => {
    const all = db.prepare('SELECT id, path, duration, mb_track_id FROM songs ORDER BY path').all();
    const songs = paths ? all.filter(({ path }) => paths.includes(path)) : all;
    return withScope(db, songs, () => exclusive({ db, config, songs }));
  };

  beforeEach(() => {
    db = openDatabase(':memory:');
    const playlist = db.prepare('INSERT INTO spotify_playlists (id, name) VALUES (?, ?)');
    [
      [ids.r4, 'Rating 4.0'],
      [ids.r5, 'Rating 5.0'],
      [ids.indie, '[Rock] Indie-Rock'],
      [ids.folk, '[Rock] Folk-Rock'],
      [ids.study, 'Study']
    ].forEach(row => playlist.run(...row));
  });

  afterEach(() => db.close());

  it('should group single value playlists by field, one member per playlist', () => {
    const groups = exclusiveGroups(config);
    expect(groups.map(({ field, targets }) => [field, targets.length])).to.deep.equal([
      ['rating', 2],
      ['grouping', 3]
    ]);
  });

  it('should report a track in two rating playlists whose copies disagree', () => {
    addSong('album/song.mp3', { POPM: popm(5), 'TXXX.sp_track_id': 'track1' });
    addSong('live/song.mp3', { POPM: popm(4), 'TXXX.sp_track_id': 'track1' });
    onSpotify(ids.r4, 'track1', 'Song');
    onSpotify(ids.r5, 'track1', 'Song');
    const [finding] = check();
    expect(finding).to.include({ file: 'album/song.mp3', field: 'rating', trackId: 'track1' });
    expect(finding.detail).to.equal(
      'rating: Band - Song on Spotify in Rating 4.0, Rating 5.0; copies disagree: album/song.mp3 says Rating 5.0; live/song.mp3 says Rating 4.0'
    );
  });

  it('should name the playlist the tags call for, and tracks not in the library', () => {
    addSong('a.mp3', { TIT1: 'IndieRock.Singles', 'TXXX.sp_track_id': 'track2' });
    onSpotify(ids.indie, 'track2', 'Two');
    onSpotify(ids.folk, 'track2', 'Two');
    onSpotify(ids.indie, 'track3', 'Three');
    onSpotify(ids.folk, 'track3', 'Three');
    // in two context playlists, which is fine
    onSpotify(ids.study, 'track2', 'Two');
    expect(check().map(({ detail }) => detail)).to.deep.equal([
      'grouping: Band - Three on Spotify in [Rock] Indie-Rock, [Rock] Folk-Rock; not in the library',
      'grouping: Band - Two on Spotify in [Rock] Indie-Rock, [Rock] Folk-Rock; tags say [Rock] Indie-Rock'
    ]);
  });

  it('should report a song whose tags match two playlists of a group', () => {
    addSong('b.mp3', { TIT1: 'IndieRock.Artists FolkRock.Artists' });
    expect(check()).to.deep.equal([
      {
        file: 'b.mp3',
        detail: 'grouping: tags match [Rock] Indie-Rock, [Rock] Folk-Rock',
        field: 'grouping',
        playlists: [ids.indie, ids.folk]
      }
    ]);
  });

  it('should only report tracks of the checked songs when the check is narrowed', () => {
    addSong('in/a.mp3', { POPM: popm(5), 'TXXX.sp_track_id': 'track4' });
    addSong('out/b.mp3', { POPM: popm(4), 'TXXX.sp_track_id': 'track5' });
    ['track4', 'track5', 'track6'].forEach(track => {
      onSpotify(ids.r4, track, track);
      onSpotify(ids.r5, track, track);
    });
    expect(check(['in/a.mp3']).map(({ trackId }) => trackId)).to.deep.equal(['track4']);
    expect(check().map(({ trackId }) => trackId)).to.have.members(['track4', 'track5', 'track6']);
  });

  it('should find nothing without exclusive groups', () => {
    addSong('c.mp3', { POPM: popm(5) });
    const all = db.prepare('SELECT id, path FROM songs').all();
    const noGroups = {
      ...config,
      sync: { playlists: [{ filter: 'rating:5.0-5.0', playlist: url(ids.r5) }] }
    };
    expect(withScope(db, all, () => exclusive({ db, config: noGroups, songs: all }))).to.deep.equal(
      []
    );
  });
});
