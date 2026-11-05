const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../db/database.js');
const { glyphs } = require('../status/bar.js');
const { spotifyIdFrame } = require('../sync/match.js');
const { barFile, barWriter, createBarPublisher, likedOnSpotify } = require('./barPublisher.js');

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
