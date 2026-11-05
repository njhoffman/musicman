const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../db/database.js');
const { glyphs } = require('../status/bar.js');
const { spotifyIdFrame } = require('../sync/match.js');
const {
  barFile,
  barWriter,
  createBarPublisher,
  likedOnSpotify,
  localLikes
} = require('./barPublisher.js');

const base = path.resolve('/music');
const config = { mpd: { baseDirectory: base } };

const settle = () => new Promise(resolve => setImmediate(resolve));

// a player with a state the test changes
const fakePlayer = (source, state = { state: null }) => {
  const player = { source, name: source, current: state, state: async () => player.current };
  return player;
};

const playing = (track, state = 'playing') => ({ state, track });
const spotifyTrack = {
  trackId: 'sp1',
  title: 'Song',
  artist: 'Band',
  position: 10,
  duration: 100
};
const mpdTrack = {
  file: path.join(base, 'Rated/a.mp3'),
  title: 'Song',
  artist: 'Band',
  position: 10,
  duration: 100
};

describe('Bar publisher', () => {
  // a publisher over a library with Rated/a.mp3 (Spotify id sp1), recording what it writes
  const setup = ({
    liked = async () => null,
    likedCached = false,
    meta = { rating: '4.5' }
  } = {}) => {
    const context = {
      clock: 1000000,
      times: {},
      written: [],
      meta,
      reads: 0,
      asks: 0,
      players: { mpd: fakePlayer('mpd'), spotify: fakePlayer('spotify') }
    };
    const openDb = () => {
      const db = openDatabase(':memory:');
      db.prepare('INSERT INTO songs (id, path, mtime, size) VALUES (1, ?, 0, 0)').run(
        'Rated/a.mp3'
      );
      db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (1, ?, ?)').run(
        spotifyIdFrame,
        'sp1'
      );
      if (likedCached) {
        db.prepare(
          "INSERT INTO spotify_playlists (id, name) VALUES ('liked', 'Liked Songs')"
        ).run();
        db.prepare(
          "INSERT INTO spotify_playlist_tracks (playlist_id, track_id) VALUES ('liked', 'sp1')"
        ).run();
      }
      return context.noDb ? null : db;
    };
    context.publisher = createBarPublisher({
      config,
      players: context.players,
      openDb,
      readSong: async () => {
        context.reads += 1;
        return context.meta;
      },
      liked: async id => {
        context.asks += 1;
        return liked(id);
      },
      writer: {
        write: (source, text) => context.written.push({ source, text }),
        remove: () => {}
      },
      now: () => context.clock,
      mtime: file => (file in context.times ? context.times[file] : 1)
    });
    context.last = () => context.written[context.written.length - 1];
    return context;
  };

  it('should publish nothing to show when nothing plays or a player is stopped', async () => {
    const context = setup();
    await context.publisher.refresh();
    expect(context.last()).to.deep.equal({ source: '', text: '' });
    context.players.mpd.current = playing(mpdTrack, 'stopped');
    await context.publisher.refresh();
    expect(context.written).to.have.length(1);
  });

  it('should find the library song of a Spotify track and its rating', async () => {
    const context = setup();
    context.players.spotify.current = playing(spotifyTrack);
    await context.publisher.refresh();
    expect(context.last().source).to.equal('spotify');
    expect(context.last().text).to.contain(glyphs.starFilled);
    expect(context.last().text).to.contain('Song - Band');
  });

  it('should show no star for a Spotify track outside the library', async () => {
    const context = setup();
    context.players.spotify.current = playing({ ...spotifyTrack, trackId: 'other' });
    await context.publisher.refresh();
    expect(context.last().text).to.not.contain(glyphs.starFilled);
    expect(context.last().text).to.not.contain(glyphs.starOutline);
  });

  it('should prefer Spotify when both play, and go back when it stops', async () => {
    const context = setup();
    context.players.spotify.current = playing(spotifyTrack);
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    expect(context.last().source).to.equal('spotify');
    context.players.spotify.current = { state: null };
    await context.publisher.refresh();
    expect(context.last().source).to.equal('mpd');
  });

  it('should show the heart from the cache for an MPD song through its file tag', async () => {
    const context = setup({ likedCached: true });
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    expect(context.last().text).to.contain(glyphs.heart);
  });

  it('should still show an MPD song when the library cannot be opened', async () => {
    const context = setup();
    context.noDb = true;
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    expect(context.last().text).to.contain(glyphs.starFilled);
    expect(context.last().text).to.not.contain(glyphs.heart);
  });

  it('should fall back to the file MPD reports when opening the library throws', async () => {
    const context = setup();
    const publisher = createBarPublisher({
      config,
      players: context.players,
      openDb: () => {
        throw new Error('newer schema');
      },
      readSong: async () => ({ rating: '5.0' }),
      liked: async () => null,
      writer: {
        write: (source, text) => context.written.push({ source, text }),
        remove: () => {}
      }
    });
    context.players.mpd.current = playing(mpdTrack);
    await publisher.refresh();
    expect(context.last().text).to.contain(glyphs.starFilled);
  });

  it('should follow Spotify for the heart, asking again only after 30 seconds', async () => {
    let answer = true;
    const context = setup({ liked: async () => answer });
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    await settle();
    expect(context.asks).to.equal(1);
    expect(context.last().text).to.contain(glyphs.heart);
    context.clock += 5000;
    await context.publisher.refresh();
    await settle();
    expect(context.asks).to.equal(1);
    answer = false;
    context.clock += 30000;
    await context.publisher.refresh();
    await settle();
    expect(context.asks).to.equal(2);
    expect(context.last().text).to.not.contain(glyphs.heart);
  });

  it('should keep the last heart when Spotify cannot be asked', async () => {
    const context = setup({
      likedCached: true,
      liked: async () => {
        throw new Error('offline');
      }
    });
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    await settle();
    expect(context.asks).to.equal(1);
    expect(context.last().text).to.contain(glyphs.heart);
  });

  describe('local files confirmed in Liked Songs', () => {
    const localTrack = {
      trackId: null,
      local: true,
      title: 'Song',
      artist: 'Band',
      album: '',
      position: 0,
      duration: 100
    };
    let dir;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-bar-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    // a publisher reading the export state in dir, over a library with Rated/a.mp3 without a Spotify id
    const publisherFor = (players, { liked = async () => null } = {}) => {
      const written = [];
      const publisher = createBarPublisher({
        config: { ...config, sync: { uploadDirectory: dir } },
        players,
        openDb: () => {
          const db = openDatabase(':memory:');
          db.prepare(
            'INSERT INTO songs (id, path, mtime, size, duration) VALUES (1, ?, 0, 0, 100)'
          ).run('Rated/a.mp3');
          const tag = db.prepare(
            'INSERT INTO song_tags (song_id, frame_id, value) VALUES (1, ?, ?)'
          );
          tag.run('TIT2', 'Song');
          tag.run('TPE1', 'Band');
          return db;
        },
        readSong: async () => ({ rating: '5.0' }),
        liked,
        writer: { write: (source, text) => written.push(text), remove: () => {} },
        mtime: () => 1
      });
      return { publisher, last: () => written[written.length - 1] };
    };
    const confirm = list =>
      fs.writeFileSync(
        path.join(dir, 'export.json'),
        JSON.stringify({ confirmed: { liked: list } })
      );

    it('should show the heart for a Spotify local file in the export state', async () => {
      confirm(['Rated/a.mp3']);
      const { publisher, last } = publisherFor({
        mpd: fakePlayer('mpd'),
        spotify: fakePlayer('spotify', playing(localTrack))
      });
      await publisher.refresh();
      expect(last()).to.contain(glyphs.heart);
    });

    it('should show no heart for a local file that was not confirmed', async () => {
      confirm(['Rated/other.mp3']);
      const { publisher, last } = publisherFor({
        mpd: fakePlayer('mpd'),
        spotify: fakePlayer('spotify', playing(localTrack))
      });
      await publisher.refresh();
      expect(last()).to.contain('Song - Band');
      expect(last()).to.not.contain(glyphs.heart);
    });

    it('should show no heart for a local file without an export state', async () => {
      const { publisher, last } = publisherFor({
        mpd: fakePlayer('mpd'),
        spotify: fakePlayer('spotify', playing(localTrack))
      });
      await publisher.refresh();
      expect(last()).to.not.contain(glyphs.heart);
    });

    it('should show the heart for the same file in MPD, and keep it when Spotify says no', async () => {
      confirm(['Rated/a.mp3']);
      const { publisher, last } = publisherFor(
        { mpd: fakePlayer('mpd', playing(mpdTrack)), spotify: fakePlayer('spotify') },
        { liked: async () => false }
      );
      await publisher.refresh();
      await settle();
      expect(last()).to.contain(glyphs.heart);
    });
  });

  it('should not ask about a paused song, nor a track without a Spotify id', async () => {
    const context = setup();
    context.players.mpd.current = playing(mpdTrack, 'paused');
    await context.publisher.refresh();
    context.players.mpd.current = playing({ ...mpdTrack, file: path.join(base, 'Unrated/b.mp3') });
    await context.publisher.refresh();
    await settle();
    expect(context.asks).to.equal(0);
  });

  it('should drop an answer about a track no longer playing', async () => {
    let release;
    const context = setup({ liked: () => new Promise(resolve => (release = resolve)) });
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    await settle();
    context.players.spotify.current = playing({ ...spotifyTrack, trackId: 'other' });
    await context.publisher.refresh();
    release(true);
    await settle();
    expect(context.last().text).to.not.contain(glyphs.heart);
  });

  it('should count the time left down between reads while playing, and hold it while paused', async () => {
    const context = setup();
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    expect(context.last().text).to.contain('-1:30');
    context.clock += 2000;
    context.publisher.tick();
    expect(context.last().text).to.contain('-1:28');
    context.players.mpd.current = playing(mpdTrack, 'paused');
    await context.publisher.refresh();
    const { length } = context.written;
    context.clock += 2000;
    context.publisher.tick();
    expect(context.written).to.have.length(length);
  });

  it('should write only what changed', async () => {
    const context = setup();
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    const { length } = context.written;
    context.publisher.tick();
    await context.publisher.refresh();
    expect(context.written).to.have.length(length);
  });

  it('should read the tags again when the file changes, not on every read', async () => {
    const context = setup({ meta: { rating: '3.0' } });
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    expect(context.last().text).to.contain(glyphs.starOutline);
    await context.publisher.refresh();
    expect(context.reads).to.equal(1);
    context.meta = { rating: '5.0' };
    context.times[mpdTrack.file] = 2;
    await context.publisher.refresh();
    expect(context.reads).to.equal(2);
    expect(context.last().text).to.contain(glyphs.starFilled);
  });

  it('should keep the star while a file moved away cannot be read', async () => {
    const context = setup();
    context.players.mpd.current = playing(mpdTrack);
    await context.publisher.refresh();
    context.meta = null;
    context.times[mpdTrack.file] = null;
    await context.publisher.refresh();
    expect(context.last().text).to.contain(glyphs.starFilled);
  });

  it('should run one more read for a burst of events waiting on the current one', async () => {
    const context = setup();
    let states = 0;
    context.players.mpd.state = async () => {
      states += 1;
      return { state: null };
    };
    const runs = [
      context.publisher.refresh(),
      context.publisher.refresh(),
      context.publisher.refresh()
    ];
    await Promise.all(runs);
    expect(states).to.equal(1);
  });

  it('should survive a failing write and try again', async () => {
    let failing = true;
    const written = [];
    const players = { mpd: fakePlayer('mpd', playing(mpdTrack)), spotify: fakePlayer('spotify') };
    const publisher = createBarPublisher({
      config,
      players,
      openDb: () => null,
      readSong: async () => null,
      liked: async () => null,
      writer: {
        write: (source, text) => {
          if (failing) {
            throw new Error('read only');
          }
          written.push({ source, text });
        },
        remove: () => {}
      }
    });
    await publisher.refresh();
    expect(written).to.have.length(0);
    failing = false;
    await publisher.refresh();
    expect(written).to.have.length(1);
  });

  describe('local likes from the Liked Songs playlist', () => {
    const staxx = {
      track: {
        name: 'STAXX',
        is_local: true,
        duration_ms: 245000,
        artists: [{ name: 'Kelsey Bulkin' }]
      }
    };
    const catalog = {
      track: { name: 'Other', is_local: false, duration_ms: 1000, artists: [{ name: 'Band' }] }
    };
    const tags = { artist: 'kelsey bulkin', title: 'staxx', duration: 245.4 };
    // a client serving a playlist the test changes, counting full fetches
    const fakeClient = () => {
      const remote = { snapshot: 'one', items: [staxx, catalog], fetches: 0, error: null };
      const api = {
        get: async url => {
          if (remote.error) {
            throw remote.error;
          }
          expect(url).to.equal('/playlists/pl1?fields=snapshot_id');
          return { snapshot_id: remote.snapshot };
        },
        paginate: async url => {
          expect(url.startsWith('/playlists/pl1/tracks?limit=100&fields=next,')).to.be.true;
          remote.fetches += 1;
          return remote.items;
        }
      };
      return { remote, client: () => api };
    };
    const refused = status => Object.assign(new Error('refused'), { status });

    it('should know nothing before the first read, then match by artist, title and length', async () => {
      const { client } = fakeClient();
      const likes = localLikes(client, 'pl1');
      expect(likes.has(tags)).to.equal(null);
      expect(await likes.refresh()).to.equal(true);
      expect(likes.has(tags)).to.equal(true);
      expect(likes.has({ ...tags, duration: 300 })).to.equal(false);
      expect(likes.has({ artist: 'Band', title: 'Other', duration: 1 })).to.equal(false);
    });

    it('should fetch the tracks only when the snapshot changes', async () => {
      const { client, remote } = fakeClient();
      const likes = localLikes(client, 'pl1');
      await likes.refresh();
      expect(await likes.refresh()).to.equal(false);
      expect(remote.fetches).to.equal(1);
      remote.snapshot = 'two';
      remote.items = [catalog];
      expect(await likes.refresh()).to.equal(true);
      expect(remote.fetches).to.equal(2);
      expect(likes.has(tags)).to.equal(false);
    });

    it('should keep the list when offline, and forget it when the playlist is refused', async () => {
      const { client, remote } = fakeClient();
      const likes = localLikes(client, 'pl1');
      await likes.refresh();
      remote.error = new Error('offline');
      expect(await likes.refresh()).to.equal(false);
      expect(likes.has(tags)).to.equal(true);
      remote.error = refused(404);
      expect(await likes.refresh()).to.equal(true);
      expect(likes.has(tags)).to.equal(null);
    });

    // a publisher playing a local file, confirmed in the export state when confirmed
    const localSetup = async ({ likes, confirmed = false }) => {
      const written = [];
      const clock = { now: 1000000 };
      const players = {
        mpd: fakePlayer('mpd'),
        spotify: fakePlayer(
          'spotify',
          playing({
            trackId: null,
            local: true,
            title: 'STAXX',
            artist: 'Kelsey Bulkin',
            position: 0,
            duration: 245
          })
        )
      };
      const publisher = createBarPublisher({
        config,
        players,
        openDb: () => null,
        readSong: async () => null,
        liked: async () => null,
        likes,
        writer: { write: (source, text) => written.push(text), remove: () => {} },
        confirmedLiked: () => confirmed,
        now: () => clock.now,
        mtime: () => 1
      });
      return { publisher, clock, players, last: () => written[written.length - 1] };
    };

    it('should show the heart once the playlist lists the file, over a missing confirmation', async () => {
      const { client } = fakeClient();
      const { publisher, last } = await localSetup({ likes: localLikes(client, 'pl1') });
      await publisher.refresh();
      await settle();
      await settle();
      expect(last()).to.contain(glyphs.heart);
    });

    it('should clear the heart of an unliked file within a check, even when confirmed', async () => {
      const { client, remote } = fakeClient();
      const { publisher, clock, last } = await localSetup({
        likes: localLikes(client, 'pl1'),
        confirmed: true
      });
      await publisher.refresh();
      await settle();
      expect(last()).to.contain(glyphs.heart);
      remote.snapshot = 'two';
      remote.items = [catalog];
      clock.now += 30000;
      await publisher.refresh();
      await settle();
      await settle();
      expect(last()).to.not.contain(glyphs.heart);
    });

    it('should fall back to the confirmed file when the playlist cannot be read', async () => {
      const { client, remote } = fakeClient();
      remote.error = refused(404);
      const { publisher, players, last } = await localSetup({
        likes: localLikes(client, 'pl1'),
        confirmed: true
      });
      // MPD names its file without a library to look it up in
      players.spotify.current = { state: null };
      players.mpd.current = playing(mpdTrack);
      await publisher.refresh();
      await settle();
      await settle();
      expect(last()).to.contain(glyphs.heart);
    });

    it('should not give a catalog track the heart of a liked local copy', async () => {
      const { client } = fakeClient();
      const likes = localLikes(client, 'pl1');
      await likes.refresh();
      const { publisher, players, last } = await localSetup({ likes });
      players.spotify.current = playing({
        trackId: 'catalog',
        title: 'STAXX',
        artist: 'Kelsey Bulkin',
        position: 0,
        duration: 245
      });
      await publisher.refresh();
      await settle();
      expect(last()).to.not.contain(glyphs.heart);
    });
  });

  describe('likedOnSpotify', () => {
    it('should ask for the track by id and pass on only a boolean', async () => {
      const paths = [];
      const answers = [[true], [], { error: 1 }];
      const client = () => ({
        get: async url => {
          paths.push(url);
          return answers.shift();
        }
      });
      const liked = likedOnSpotify(client);
      expect(await liked('a b')).to.equal(true);
      expect(paths[0]).to.equal('/me/tracks/contains?ids=a%20b');
      expect(await liked('x')).to.equal(null);
    });
  });

  describe('barFile and barWriter', () => {
    it('should live under XDG_RUNTIME_DIR', () => {
      expect(barFile({ XDG_RUNTIME_DIR: '/run/user/9' })).to.equal(
        '/run/user/9/musicman/now-playing'
      );
    });

    it('should write the player and line, leaving no temporary file, and remove them', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-bar-'));
      try {
        const file = path.join(dir, 'musicman', 'now-playing');
        const writer = barWriter(file);
        writer.write('mpd', 'line');
        expect(fs.readFileSync(file, 'utf8')).to.equal('mpd\nline\n');
        expect(fs.readdirSync(path.dirname(file))).to.deep.equal(['now-playing']);
        writer.remove();
        writer.remove();
        expect(fs.existsSync(file)).to.be.false;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
