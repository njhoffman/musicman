const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { mergeAssignments } = require('../metadata/write.js');
const { groupingTargets, menuButtons, songActions, stars } = require('./actions.js');

describe('Menu song actions', () => {
  const study = 'StudyPlaylist000000000';
  const hot = 'HotPlaylist00000000000';
  const rated4 = 'Rated4Playlist00000000';
  const rated45 = 'Rated45Playlist0000000';
  const ignore = 'IgnorePlaylist00000000';
  const ambient = 'AmbientPlaylist0000000';
  const rock = 'RockPlaylist0000000000';
  const config = {
    mpd: { baseDirectory: '/music' },
    library: {
      tags: [
        { name: 'context', id: 'TXXX.context', multi: true },
        { name: 'picks', id: 'TXXX.picks', multi: true },
        { name: 'grouping', id: 'TIT1' }
      ]
    },
    sync: {
      likedRating: 4.5,
      ignorePlaylist: ignore,
      playlists: [
        { filter: 'context:Study', playlist: study },
        { filter: 'picks:Hot', playlist: hot },
        { filter: 'rating:4.0-4.0', playlist: rated4 },
        { filter: 'rating:4.5-4.5', playlist: rated45 },
        { filter: 'grouping:Ambient.Artists', playlist: ambient },
        { filter: 'grouping:Rock.Singles', playlist: rock },
        { filter: 'grouping:Jazz rating:4.5', playlist: hot }
      ]
    },
    menu: {
      buttons: [
        { label: 'Study', filter: 'context:Study', key: 'a' },
        { label: 'Hot', filter: 'picks:hot' },
        { label: "Nick's Picks", filter: 'picks:Nick' }
      ],
      ratings: [4, 4.5, 5]
    }
  };

  describe('menuButtons', () => {
    it('should map buttons and ratings to the sync.playlists target of the same filter', () => {
      const { tags, ratings } = menuButtons(config);
      expect(
        tags.map(({ label, field, value, key, playlistId }) => [
          label,
          field,
          value,
          key,
          playlistId
        ])
      ).to.deep.equal([
        ['Study', 'context', 'Study', 'a', study],
        ['Hot', 'picks', 'hot', 's', hot],
        ["Nick's Picks", 'picks', 'Nick', 'd', null]
      ]);
      expect(ratings.map(({ value, key, playlistId }) => [value, key, playlistId])).to.deep.equal([
        ['4.0', '1', rated4],
        ['4.5', '2', rated45],
        ['5.0', '3', null]
      ]);
    });

    it('should reject a button whose filter is not one value of a multi value field', () => {
      const bad = { ...config, menu: { buttons: [{ label: 'Rock', filter: 'grouping:Rock' }] } };
      expect(() => menuButtons(bad)).to.throw(
        "menu.buttons[0].filter 'grouping:Rock' must be one value"
      );
    });
  });

  describe('songActions', () => {
    let db;
    let writes;
    let runs;
    let requests;

    const cache = (playlistId, trackIds) => {
      db.prepare(
        'INSERT OR IGNORE INTO spotify_playlists (id, name, snapshot_id) VALUES (?, ?, ?)'
      ).run(playlistId, playlistId, 's1');
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

    // tracks Spotify has in Liked Songs; null makes the live check fail, leaving the cache
    let likedOnSpotify = null;
    const client = {
      get: async url => {
        if (url.startsWith('/me/tracks/contains')) {
          if (!likedOnSpotify) {
            throw new Error('Spotify unavailable');
          }
          return [likedOnSpotify.has(decodeURIComponent(url.split('ids=')[1]))];
        }
        return { name: 'x', snapshot_id: 's1' };
      },
      paginate: async () => [],
      request: async (method, url, body) => {
        requests.push([method, url, body]);
        return null;
      }
    };
    const metas = {
      '/music/a.mp3': {
        rating: '4.0',
        context: 'Run,Study',
        picks: '',
        grouping: 'Ambient.Artists'
      }
    };
    const actions = () =>
      songActions({
        config,
        // the database stays open across the test, the menu closes what it opens
        openDb: () => ({ prepare: sql => db.prepare(sql), close: () => {} }),
        client: () => client,
        readSongs: async files => files.map(file => [file, metas[file] || {}]),
        writeSong: async (file, assignments) => {
          writes.push([file, assignments]);
          const after = mergeAssignments(metas[file], assignments);
          return { ...after, context: [].concat(after.context).join(',') };
        },
        withRun: async (label, action) => {
          runs.push(label);
          return action();
        }
      });
    const press = async (context, key) => {
      const menu = actions();
      const song = await menu.song(context);
      const entries = await menu.entries({ ...context, song });
      const entry = entries.find(candidate => candidate.key === key);
      return { entry, run: () => entry.run(), entries };
    };

    beforeEach(() => {
      db = openDatabase(':memory:');
      writes = [];
      runs = [];
      requests = [];
      const { lastInsertRowid } = db
        .prepare("INSERT INTO songs (path, mtime, size) VALUES ('a.mp3', 1, 1)")
        .run();
      db.prepare(
        "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', 'ta')"
      ).run(lastInsertRowid);
      cache('liked', []);
      [study, hot, rated4, rated45, ignore, ambient, rock].forEach(id => cache(id, []));
      // groupings in the library: Rock.Singles twice, Ambient.Artists (song a) and Jazz once
      const grouping = db.prepare(
        "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TIT1', ?)"
      );
      grouping.run(lastInsertRowid, 'Ambient.Artists');
      ['r1.mp3', 'r2.mp3', 'j.mp3'].forEach((file, i) => {
        const { lastInsertRowid: id } = db
          .prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)')
          .run(file);
        grouping.run(id, i < 2 ? 'Rock.Singles' : 'Jazz');
      });
      likedOnSpotify = null;
    });

    afterEach(() => {
      db.close();
    });

    const mpd = {
      player: { source: 'mpd' },
      track: { file: '/music/a.mp3', title: 'A', artist: 'X' }
    };
    const linked = {
      player: { source: 'spotify' },
      track: { trackId: 'ta', title: 'A', artist: 'X' }
    };
    const remote = {
      player: { source: 'spotify' },
      track: { trackId: 'tz', title: 'Z', artist: 'Y' }
    };

    it('should show the local tags of an MPD song and toggle them with + and -', async () => {
      const study1 = await press(mpd, 'a');
      expect(study1.entry.active).to.equal(true);
      await study1.run();
      const hot1 = await press(mpd, 's');
      expect(hot1.entry.active).to.equal(false);
      await hot1.run();
      expect(writes).to.deep.equal([
        ['/music/a.mp3', { context: ['-Study'] }],
        ['/music/a.mp3', { picks: ['+hot'] }]
      ]);
      expect(runs).to.deep.equal(['context=-Study X - A', 'picks=+hot X - A']);
      expect(requests).to.be.empty;
    });

    it('should set a rating but never clear the current one, and leave like and ignore to Spotify songs', async () => {
      const { entries } = await press(mpd, '1');
      const byKey = key => entries.find(entry => entry.key === key);
      expect(byKey('1')).to.include({ active: true, disabled: true });
      expect(byKey('y')).to.include({ active: false, disabled: true });
      expect(byKey('x')).to.include({ disabled: true });
      await byKey('2').run();
      expect(writes).to.deep.equal([['/music/a.mp3', { rating: '4.5' }]]);
    });

    it('should tag a Spotify song in the library locally and push the change right away', async () => {
      cache(study, ['ta']);
      db.prepare('INSERT INTO spotify_synced (playlist_id, track_id) VALUES (?, ?)').run(
        study,
        'ta'
      );
      const { entry, run } = await press(linked, 'a');
      expect(entry.active).to.equal(true);
      const result = await run();
      expect(writes).to.deep.equal([['/music/a.mp3', { context: ['-Study'] }]]);
      expect(requests).to.deep.equal([
        ['DELETE', `/playlists/${study}/items`, { items: [{ uri: 'spotify:track:ta' }] }]
      ]);
      expect(result.pushed).to.deep.equal([{ id: study, name: study, action: 'remove' }]);
      expect(tracksIn(study)).to.be.empty;
    });

    it('should add a Spotify song not in the library to the playlist of a button, and remove it again', async () => {
      const add = await press(remote, 's');
      expect(add.entry).to.include({ active: false, disabled: false });
      await add.run();
      expect(requests).to.deep.equal([
        ['POST', `/playlists/${hot}/items`, { uris: ['spotify:track:tz'] }]
      ]);
      expect(tracksIn(hot)).to.deep.equal(['tz']);
      const synced = db.prepare('SELECT * FROM spotify_synced').all();
      expect(synced).to.be.empty;
      const remove = await press(remote, 's');
      expect(remove.entry.active).to.equal(true);
      await remove.run();
      expect(requests[1]).to.deep.equal([
        'DELETE',
        `/playlists/${hot}/items`,
        { items: [{ uri: 'spotify:track:tz' }] }
      ]);
      expect(writes).to.be.empty;
    });

    it('should keep a Spotify song not in the library in one rating playlist at a time', async () => {
      cache(rated4, ['tz']);
      const { entries } = await press(remote, '2');
      expect(entries.find(entry => entry.key === '1')).to.include({ active: true, disabled: true });
      expect(entries.find(entry => entry.key === '3')).to.include({ disabled: true });
      await entries.find(entry => entry.key === '2').run();
      expect(requests.map(([method, url]) => [method, url])).to.deep.equal([
        ['DELETE', `/playlists/${rated4}/items`],
        ['POST', `/playlists/${rated45}/items`]
      ]);
    });

    it('should like and ignore Spotify songs not in the library, and disable buttons without a playlist', async () => {
      const { entries } = await press(remote, 'y');
      const byKey = key => entries.find(entry => entry.key === key);
      expect(byKey('d')).to.include({ disabled: true });
      await byKey('y').run();
      await byKey('x').run();
      expect(requests).to.deep.equal([
        ['PUT', '/me/tracks', { ids: ['tz'] }],
        ['POST', `/playlists/${ignore}/items`, { uris: ['spotify:track:tz'] }]
      ]);
      expect(tracksIn('liked')).to.deep.equal(['tz']);
      const again = await press(remote, 'y');
      expect(again.entry).to.include({ label: 'unlike', active: true });
    });

    it('should show Liked Songs as Spotify has it now and correct the cache', async () => {
      likedOnSpotify = new Set(['tz']);
      const liked = await press(remote, 'y');
      expect(liked.entry).to.include({ label: 'unlike', active: true });
      expect(tracksIn('liked')).to.deep.equal(['tz']);
      // pressing it removes the track, it never adds it a second time
      await liked.run();
      expect(requests).to.deep.equal([['DELETE', '/me/tracks', { ids: ['tz'] }]]);

      likedOnSpotify = new Set();
      cache('liked', ['tz']);
      const unliked = await press(remote, 'y');
      expect(unliked.entry).to.include({ label: 'like', active: false });
      expect(tracksIn('liked')).to.be.empty;
    });

    it('should not record a like that Spotify already has', async () => {
      const { entry } = await press(remote, 'y');
      expect(entry.active).to.equal(false);
      // liked in the app after the menu was drawn
      likedOnSpotify = new Set(['tz']);
      const result = await entry.run();
      expect(result).to.deep.equal({ unchanged: 'liked' });
      expect(requests).to.be.empty;
    });

    it('should pick the grouping of a library song from the groupings in use, most used first', async () => {
      const { entry } = await press(mpd, 'g');
      expect(entry).to.include({ caption: 'Ambient.Artists', active: true, disabled: false });
      const choices = await entry.choices();
      expect(choices.map(({ label, active, disabled }) => [label, active, disabled])).to.deep.equal(
        [
          ['Rock.Singles', false, false],
          ['Ambient.Artists', true, true],
          ['Jazz', false, false]
        ]
      );
      await choices[0].run();
      expect(writes).to.deep.equal([['/music/a.mp3', { grouping: 'Rock.Singles' }]]);
      expect(runs).to.deep.equal(['grouping=Rock.Singles X - A']);
    });

    it('should move a Spotify song not in the library between grouping playlists', async () => {
      cache(ambient, ['tz']);
      const { entry } = await press(remote, 'g');
      expect(entry).to.include({ caption: 'Ambient.Artists', active: true });
      const choices = await entry.choices();
      // Jazz has no playlist of its own (its only entry also filters on rating)
      expect(choices.find(choice => choice.label === 'Jazz').disabled).to.equal(true);
      await choices.find(choice => choice.label === 'Rock.Singles').run();
      expect(requests.map(([method, url]) => [method, url])).to.deep.equal([
        ['DELETE', `/playlists/${ambient}/items`],
        ['POST', `/playlists/${rock}/items`]
      ]);
      expect(tracksIn(rock)).to.deep.equal(['tz']);
      expect(writes).to.be.empty;
    });

    it('should map only single grouping filters to grouping playlists', () => {
      expect(groupingTargets(config)).to.deep.equal([
        { value: 'Ambient.Artists', id: ambient },
        { value: 'Rock.Singles', id: rock }
      ]);
    });

    it('should describe songs in and out of the library', async () => {
      const menu = actions();
      expect((await menu.song(linked)).details).to.deep.equal([
        '★★★★  4.0',
        'context  <b>Run, Study</b>'
      ]);
      expect((await menu.song(remote)).status).to.deep.equal(['not in library']);
      expect(stars('4.5')).to.equal('★★★★½');
    });
  });
});
