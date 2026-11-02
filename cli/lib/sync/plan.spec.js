const _ = require('lodash');
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
    item: {
      id,
      name,
      duration_ms: 1,
      artists: [{ name: 'A' }],
      album: { name: 'B' },
      external_ids: { isrc: `ISRC-${id}` }
    }
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
        db
          .prepare("SELECT isrc FROM spotify_playlist_tracks WHERE playlist_id = 'aaa'")
          .all()
          .map(row => row.isrc)
      ).to.deep.equal(['ISRC-p1', 'ISRC-p2']);
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
        is_local: 1,
        isrc: null
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

    it('should leave sync.ignorePlaylist out of the targets and its tracks out of pull', () => {
      const ignoreId = 'IgnorePlaylist00000000';
      db.prepare("INSERT INTO spotify_playlists (id, name) VALUES (?, 'Ignore')").run(ignoreId);
      db.prepare(
        "INSERT INTO spotify_playlist_tracks (playlist_id, track_id, is_local) VALUES (?, 'elsewhere', 0)"
      ).run(ignoreId);
      const plan = syncPlan(db, { ...config, sync: { ignorePlaylist: ignoreId } }, songs);
      expect(plan.map(target => target.id)).to.deep.equal(['liked']);
      expect(plan[0].pull).to.be.empty;
    });

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

    it('should remove the track of a song taken out of the library instead of pulling it', () => {
      // 'elsewhere' was the track of a compilation copy dropped in favor of its album copy
      db.prepare(
        "INSERT INTO excluded_songs (path, track_id, kept) VALUES ('comp/e.mp3', 'elsewhere', 'a.mp3')"
      ).run();
      const [liked] = syncPlan(db, config, songs);
      expect(liked.reject.map(track => [track.track_id, track.file])).to.deep.equal([
        ['elsewhere', '/music/comp/e.mp3']
      ]);
      expect(liked.pull).to.be.empty;
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

    describe('with several files linked to one track', () => {
      // c2.mp3 is a second copy of c.mp3 (track tc), e.g. from a compilation
      beforeEach(() => {
        const { lastInsertRowid } = db
          .prepare("INSERT INTO songs (path, mtime, size) VALUES ('c2.mp3', 1, 1)")
          .run();
        db.prepare(
          "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', 'tc')"
        ).run(lastInsertRowid);
      });
      const copy = (targets, extra = {}) => [
        ...songs,
        { file: '/music/c2.mp3', targets, ...extra }
      ];

      it('should keep a track in sync when any copy belongs, even if another copy does not', () => {
        synced(['ta', 'tc']);
        const [liked] = syncPlan(db, config, copy(['liked']));
        expect(liked.prune).to.be.empty;
        expect(liked.spotifyAdded).to.be.empty;
        expect(liked.inSync).to.deep.equal(['ta', 'tc']);
      });

      it('should prune a track only when no copy belongs, listing every copy', () => {
        synced(['ta', 'tc']);
        const [liked] = syncPlan(db, config, copy([]));
        expect(liked.prune.map(track => [track.track_id, track.files])).to.deep.equal([
          ['tc', ['/music/c.mp3', '/music/c2.mp3']]
        ]);
      });

      it('should list every copy of a track added on Spotify', () => {
        const [liked] = syncPlan(db, config, copy([]));
        expect(liked.spotifyAdded.map(track => track.files)).to.deep.equal([
          ['/music/c.mp3', '/music/c2.mp3']
        ]);
      });

      describe('in playlists a song belongs in at most one of (rating, grouping)', () => {
        const r4 = '0000000000000000000004';
        const r5 = '0000000000000000000005';
        const study = '000000000000000000000s';
        const url = id => `https://open.spotify.com/playlist/${id}`;
        const exclusiveConfig = {
          ...config,
          library: { tags: [{ name: 'context', id: 'TXXX.Context', multi: true }] },
          sync: {
            playlists: [
              { filter: 'rating:4.0-4.0', playlist: url(r4) },
              { filter: 'rating:5.0-5.0', playlist: url(r5) },
              { filter: 'context:Study', playlist: url(study) }
            ]
          }
        };
        beforeEach(() => {
          const insert = db.prepare('INSERT INTO spotify_playlists (id, name) VALUES (?, ?)');
          insert.run(r4, 'Rating 4.0');
          insert.run(r5, 'Rating 5.0');
          insert.run(study, 'Study');
        });
        const plan = (c, c2) =>
          _.keyBy(
            syncPlan(db, exclusiveConfig, [
              ..._.reject(songs, { file: '/music/c.mp3' }),
              { file: '/music/c.mp3', targets: c },
              { file: '/music/c2.mp3', targets: c2 }
            ]),
            'name'
          );

        it('should add a track whose copies disagree to none of them, listed as conflict', () => {
          const targets = plan([r4, study], [r5, study]);
          ['Rating 4.0', 'Rating 5.0'].forEach(name => {
            expect(targets[name].add).to.be.empty;
            expect(targets[name].conflict.map(song => song.trackId)).to.deep.equal(['tc']);
          });
          // other playlists still get the track
          expect(_.uniq(targets.Study.add.map(song => song.trackId))).to.deep.equal(['tc']);
          expect(targets.Study.conflict).to.be.empty;
        });

        it('should add a track whose copies agree', () => {
          const targets = plan([r5], [r5]);
          expect(_.uniq(targets['Rating 5.0'].add.map(song => song.trackId))).to.deep.equal(['tc']);
          expect(targets['Rating 5.0'].conflict).to.be.empty;
        });

        it('should keep a disagreeing track where it is and not prune it', () => {
          db.prepare(
            "INSERT INTO spotify_playlist_tracks (playlist_id, track_id, is_local) VALUES (?, 'tc', 0)"
          ).run(r4);
          db.prepare("INSERT INTO spotify_synced (playlist_id, track_id) VALUES (?, 'tc')").run(r4);
          const targets = plan([r4], [r5]);
          expect(targets['Rating 4.0'].prune).to.be.empty;
          expect(targets['Rating 4.0'].inSync).to.deep.equal(['tc']);
          expect(targets['Rating 5.0'].add).to.be.empty;
          expect(targets['Rating 5.0'].conflict.map(song => song.trackId)).to.deep.equal(['tc']);
        });
      });

      it('should leave a track alone when any copy is outside sync.scope', () => {
        synced(['ta', 'tc']);
        const [liked] = syncPlan(db, config, copy([], { outOfScope: true }));
        expect(liked.prune).to.be.empty;
        expect(liked.spotifyAdded).to.be.empty;
      });
    });

    describe('with another release of a library song on Spotify', () => {
      // ta2 is another release (the single, say) of a.mp3's track ta: the same ISRC
      const other = 'p0000000000000000000o1';
      const isrc = (file, value, frame = 'TXXX.sp_isrc') =>
        db
          .prepare(
            `INSERT INTO song_tags (song_id, frame_id, value)
             SELECT id, ?, ? FROM songs WHERE path = ?`
          )
          .run(frame, value, file);
      const inOther = (...trackIds) => {
        const insert = db.prepare(
          'INSERT INTO spotify_playlist_tracks (playlist_id, track_id, is_local, isrc) VALUES (?, ?, 0, ?)'
        );
        trackIds.forEach(trackId =>
          insert.run(other, trackId, trackId.startsWith('ta') ? 'US1' : null)
        );
      };
      const planFor = (aTargets, planConfig = config) =>
        _.keyBy(
          syncPlan(
            db,
            planConfig,
            songs.map(song =>
              song.file === '/music/a.mp3' ? { ...song, targets: aTargets } : song
            )
          ),
          'id'
        )[other];

      beforeEach(() => {
        db.prepare("INSERT INTO spotify_playlists (id, name) VALUES (?, 'Other')").run(other);
        isrc('a.mp3', 'US1');
      });

      it('should count it as the song: not pulled, and the song not added next to it', () => {
        inOther('ta2');
        const target = planFor(['liked', other]);
        expect(target.pull).to.be.empty;
        expect(target.add).to.be.empty;
        expect(target.inSync).to.deep.equal(['ta']);
      });

      it('should give the song the target as added on Spotify when its tags lack it', () => {
        inOther('ta2');
        const target = planFor(['liked']);
        expect(target.pull).to.be.empty;
        expect(
          target.spotifyAdded.map(track => [track.track_id, track.libraryId, track.file])
        ).to.deep.equal([['ta2', 'ta', '/music/a.mp3']]);
      });

      it('should add the target once when both releases are in it', () => {
        inOther('ta', 'ta2');
        expect(planFor(['liked']).spotifyAdded.map(track => track.libraryId)).to.deep.equal(['ta']);
      });

      it('should prune both releases by their own ids and record the library track as synced', () => {
        inOther('ta', 'ta2');
        db.prepare("INSERT INTO spotify_synced (playlist_id, track_id) VALUES (?, 'ta')").run(
          other
        );
        const target = planFor(['liked']);
        expect(ids(target.prune, 'track_id')).to.deep.equal(['ta', 'ta2']);
        recordSynced(db, [target]);
        expect(
          ids(
            db.prepare('SELECT track_id FROM spotify_synced WHERE playlist_id = ?').all(other),
            'track_id'
          )
        ).to.deep.equal(['ta']);
      });

      it('should pull a track without an ISRC or with one no song has', () => {
        inOther('tx');
        db.prepare(
          "INSERT INTO spotify_playlist_tracks (playlist_id, track_id, is_local, isrc) VALUES (?, 'ty', 0, 'US9')"
        ).run(other);
        expect(ids(planFor(['liked']).pull, 'track_id')).to.deep.equal(['tx', 'ty']);
      });

      it('should not count a release rejected in review as the song', () => {
        inOther('ta2');
        const songId = db.prepare("SELECT id FROM songs WHERE path = 'e.mp3'").get().id;
        db.prepare(
          `INSERT INTO spotify_matches (song_id, status, rejected) VALUES (?, 'rejected', '["ta2"]')`
        ).run(songId);
        const target = planFor(['liked']);
        expect(target.spotifyAdded).to.be.empty;
        expect(ids(target.reject, 'track_id')).to.deep.equal(['ta2']);
      });

      it('should read the ISRC from the field spotify.fields names', () => {
        db.prepare("DELETE FROM song_tags WHERE frame_id = 'TXXX.sp_isrc'").run();
        isrc('a.mp3', 'US1', 'TXXX.my_isrc');
        inOther('ta2');
        const custom = {
          ...config,
          spotify: { fields: [{ path: 'track.external_ids.isrc', name: 'my_isrc' }] }
        };
        expect(planFor(['liked', other], custom).pull).to.be.empty;
        expect(ids(planFor(['liked', other]).pull, 'track_id')).to.deep.equal(['ta2']);
      });
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
