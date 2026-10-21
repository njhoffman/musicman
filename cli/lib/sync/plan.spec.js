const sinon = require('sinon');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { refreshCache, toRow } = require('./cache.js');
const { syncPlan } = require('./plan.js');

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
        ['d.mp3', null]
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

    it('should report songs to add, without ids, to prune, and to pull', () => {
      const songs = [
        { file: '/music/a.mp3', targets: ['liked'] },
        { file: '/music/b.mp3', targets: ['liked'] },
        { file: '/music/c.mp3', targets: [] },
        { file: '/music/d.mp3', targets: ['liked'] }
      ];
      const [liked] = syncPlan(db, config, songs);
      expect(liked).to.include({ name: 'Liked Songs', remote: 4, local: 3 });
      expect(liked.add.map(song => [song.file, song.trackId])).to.deep.equal([
        ['/music/b.mp3', 'tb']
      ]);
      expect(liked.noId.map(song => song.file)).to.deep.equal(['/music/d.mp3']);
      expect(liked.prune.map(track => track.track_id)).to.deep.equal(['tc']);
      expect(liked.pull.map(track => track.track_id)).to.deep.equal(['elsewhere']);
    });
  });
});
