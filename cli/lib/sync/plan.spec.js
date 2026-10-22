const sinon = require('sinon');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { refreshCache, toRow } = require('./cache.js');
const { recordSynced, syncPlan, syncedTracks } = require('./plan.js');

describe('Sync Cache and Plan', () => {
  let db;
  const config = { mpd: { baseDirectory: '/music' } };
  const entry = (id, name = id) => ({
    added_at: 'x',
    is_local: false,
    item: { id, name, duration_ms: 1, artists: [{ name: 'A' }], album: { name: 'B' } }
  });

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('refreshCache', () => {
    const client = snapshots => {
      const get = sinon.stub().callsFake(async url => {
        const id = url.match(/playlists\/(\w+)/)[1];
        return { name: `Playlist ${id}`, snapshot_id: snapshots[id] };
      });
      const paginate = sinon.stub().callsFake(async url => {
        if (url.startsWith('/me/tracks')) {
          return [{ added_at: 'x', track: { id: 'liked1', name: 'L', artists: [], album: {} } }];
        }
        return [entry('p1'), entry('p2')];
      });
      return { get, paginate };
    };
    const tracks = id =>
      db.prepare('SELECT track_id FROM spotify_playlist_tracks WHERE playlist_id = ?').all(id);

    it('should store Liked Songs and playlist tracks', async () => {
      const summary = await refreshCache(db, client({ aaa: 's1' }), ['aaa']);
      expect(summary.refreshed).to.deep.equal(['liked', 'aaa']);
      expect(tracks('liked').map(row => row.track_id)).to.deep.equal(['liked1']);
      expect(tracks('aaa').map(row => row.track_id)).to.deep.equal(['p1', 'p2']);
      expect(
        db.prepare("SELECT name, snapshot_id FROM spotify_playlists WHERE id = 'aaa'").get()
      ).to.deep.include({
        name: 'Playlist aaa',
        snapshot_id: 's1'
      });
    });

    it('should not fetch playlist items again when the snapshot did not change', async () => {
      await refreshCache(db, client({ aaa: 's1' }), ['aaa']);
      const again = client({ aaa: 's1' });
      const summary = await refreshCache(db, again, ['aaa']);
      expect(summary.unchanged).to.deep.equal(['aaa']);
      expect(again.paginate).to.have.been.calledOnce;
    });

    it('should read tracks from item or track entries', () => {
      expect(
        toRow({ track: { id: 't', name: 'N', artists: [{ name: 'A' }, { name: 'B' }] } })
      ).to.include({
        track_id: 't',
        artists: 'A, B'
      });
      expect(toRow({ is_local: true, item: { id: null, name: 'Local' } })).to.include({
        track_id: null,
        is_local: 1
      });
    });
  });

  describe('syncPlan', () => {
    beforeEach(() => {
      const insertSong = db.prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)');
      const tag = db.prepare(
        "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', ?)"
      );
      [
        ['a.mp3', 'ta'],
        ['b.mp3', 'tb'],
        ['c.mp3', 'tc'],
        ['d.mp3', null],
        ['e.mp3', 'te']
      ].forEach(([file, trackId]) => {
        const { lastInsertRowid } = insertSong.run(file);
        if (trackId) {
          tag.run(lastInsertRowid, trackId);
        }
      });
      db.prepare("INSERT INTO spotify_playlists (id, name) VALUES ('liked', 'Liked Songs')").run();
      const remote = db.prepare(
        "INSERT INTO spotify_playlist_tracks (playlist_id, track_id, is_local) VALUES ('liked', ?, ?)"
      );
      remote.run('ta', 0);
      remote.run('tc', 0);
      remote.run('elsewhere', 0);
      remote.run(null, 1);
    });

    const songs = [
      { file: '/music/a.mp3', targets: ['liked'] },
      { file: '/music/b.mp3', targets: ['liked'] },
      { file: '/music/c.mp3', targets: [] },
      { file: '/music/d.mp3', targets: ['liked'] },
      { file: '/music/e.mp3', targets: ['liked'] }
    ];
    const synced = trackIds => {
      const insert = db.prepare(
        "INSERT INTO spotify_synced (playlist_id, track_id) VALUES ('liked', ?)"
      );
      trackIds.forEach(trackId => insert.run(trackId));
    };
    const ids = (list, key) => list.map(item => item[key]);

    it('should report songs to add, without ids, and to pull', () => {
      const [liked] = syncPlan(db, config, songs);
      expect(liked).to.include({ name: 'Liked Songs', remote: 4, local: 4 });
      expect(liked.add.map(song => [song.file, song.trackId])).to.deep.equal([
        ['/music/b.mp3', 'tb'],
        ['/music/e.mp3', 'te']
      ]);
      expect(ids(liked.noId, 'file')).to.deep.equal(['/music/d.mp3']);
      expect(ids(liked.pull, 'track_id')).to.deep.equal(['elsewhere']);
      expect(liked.inSync).to.deep.equal(['ta']);
    });

    it('should treat tracks only on Spotify as added there when they were never in sync', () => {
      const [liked] = syncPlan(db, config, songs);
      expect(liked.prune).to.be.empty;
      expect(liked.spotifyAdded.map(track => [track.track_id, track.file])).to.deep.equal([
        ['tc', '/music/c.mp3']
      ]);
    });

    it('should tell local changes from changes made on Spotify by the last synced state', () => {
      synced(['ta', 'tc', 'te']);
      const [liked] = syncPlan(db, config, songs);
      // c was in sync and its tags changed locally: prune; e was in sync and was removed on Spotify
      expect(ids(liked.prune, 'track_id')).to.deep.equal(['tc']);
      expect(liked.spotifyAdded).to.be.empty;
      expect(ids(liked.spotifyRemoved, 'trackId')).to.deep.equal(['te']);
      expect(ids(liked.add, 'trackId')).to.deep.equal(['tb']);
    });

    it('should leave songs outside sync.scope alone where they are on Spotify', () => {
      synced(['ta', 'tc']);
      const scoped = songs.map(song =>
        song.file === '/music/c.mp3' ? { ...song, outOfScope: true } : song
      );
      const [liked] = syncPlan(db, config, scoped);
      // c is on Spotify and was in sync, but outside the scope it is neither pruned nor pulled
      expect(liked.prune).to.be.empty;
      expect(liked.spotifyAdded).to.be.empty;
      expect(ids(liked.pull, 'track_id')).to.deep.equal(['elsewhere']);
    });

    it('should list tracks rejected in review for removal instead of as downloads', () => {
      // 'elsewhere' was pushed for e.mp3, rejected in review, and e.mp3 is unlinked
      const songId = db.prepare("SELECT id FROM songs WHERE path = 'e.mp3'").get().id;
      db.prepare(
        `INSERT INTO spotify_matches (song_id, status, rejected) VALUES (?, 'rejected', '["elsewhere"]')`
      ).run(songId);
      const [liked] = syncPlan(db, config, songs);
      expect(liked.reject.map(track => [track.track_id, track.file])).to.deep.equal([
        ['elsewhere', '/music/e.mp3']
      ]);
      expect(liked.pull).to.be.empty;
    });

    it('should record the agreed tracks and keep unresolved changes as they were', () => {
      const stored = () =>
        ids(db.prepare('SELECT track_id FROM spotify_synced ORDER BY track_id').all(), 'track_id');
      recordSynced(db, syncPlan(db, config, songs));
      // only ta is agreed on; tb (add) and tc (added on Spotify) stay out until resolved
      expect(stored()).to.deep.equal(['ta']);

      synced(['tc', 'te']);
      recordSynced(db, syncPlan(db, config, songs));
      expect(stored()).to.deep.equal(['ta', 'tc', 'te']);
      expect(syncedTracks(db).liked).to.be.an.instanceOf(Set);
    });
  });
});
