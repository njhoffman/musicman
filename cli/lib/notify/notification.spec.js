const { expect } = require('chai');
const { EventEmitter } = require('events');

const { openDatabase } = require('../db/database.js');
const {
  buildNotification,
  createNotifier,
  sendNotification,
  songNotice,
  trackKey,
  watchMpd,
  watchSongs,
  watchSpotify
} = require('./notification.js');

const daemon = {
  bin: '/usr/bin/notify-send',
  icon: true,
  duration: 5000,
  urgency: 'LOW',
  fields: ['context', 'mood']
};

const notice = {
  source: 'Spotify',
  title: 'Fade Into You',
  artist: 'Mazzy Star',
  album: 'So Tonight',
  rating: '4.5',
  inLibrary: true,
  meta: { rating: '4.5', context: 'Study,Drive,', mood: 'Mellow', picks: 'Nick' },
  cover: '/covers/a.jpg'
};

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('Notify Daemon', () => {
  describe('buildNotification', () => {
    it('should show stars and title, artist and album, colored tags, the player and the cover', () => {
      const { bin, args } = buildNotification(notice, daemon);
      expect(bin).to.equal('/usr/bin/notify-send');
      expect(args.slice(0, 5)).to.deep.equal([
        '--urgency=low',
        '--expire-time=5000',
        '--app-name=Spotify',
        '--print-id',
        '--icon=/covers/a.jpg'
      ]);
      expect(args[5]).to.equal('★★★★½  Fade Into You');
      const [artist, tags] = args[6].split('\n');
      expect(artist).to.equal('<b>Mazzy Star</b>  ·  So Tonight');
      expect(tags.match(/> (\w+) </g)).to.deep.equal(['> Study <', '> Drive <', '> Mellow <']);
      // picks is not in daemon.fields
      expect(tags).to.not.include('Nick');
    });

    it('should replace the last notification and leave out the cover when icon is off', () => {
      const { args } = buildNotification(notice, { ...daemon, icon: false }, '42');
      expect(args).to.include('--replace-id=42');
      expect(args.some(arg => arg.startsWith('--icon'))).to.equal(false);
    });

    it('should mark unrated songs and songs not in the library, escaping markup', () => {
      const unrated = buildNotification(
        { ...notice, rating: null, meta: {}, artist: 'A & B' },
        daemon
      ).args;
      expect(unrated.slice(-2)).to.deep.equal([
        'Fade Into You',
        '<b>A &amp; B</b>  ·  So Tonight\n<span foreground="#7f8796">unrated</span>'
      ]);
      const remote = buildNotification(
        { ...notice, rating: null, inLibrary: false, meta: null },
        daemon
      ).args;
      expect(remote[remote.length - 1]).to.include('<i>not in library</i>');
    });

    it('should show context, mood and picks without daemon.fields', () => {
      const { args } = buildNotification(notice, { ...daemon, fields: undefined });
      expect(args[args.length - 1]).to.include(' Nick </span>');
    });
  });

  describe('songNotice', () => {
    let db;
    const config = { mpd: { baseDirectory: '/music' }, db: { path: ':memory:' } };
    const tags = { '/music/a.mp3': { rating: '4.0', context: 'Study' } };
    const deps = () => ({
      config,
      openDb: () => ({ prepare: sql => db.prepare(sql), close: () => {} }),
      readSong: async file => tags[file] || null,
      cover: async (track, { file }) => (file ? `${file}.jpg` : track.artUrl || null)
    });

    beforeEach(() => {
      db = openDatabase(':memory:');
      const { lastInsertRowid } = db
        .prepare("INSERT INTO songs (path, mtime, size) VALUES ('a.mp3', 1, 1)")
        .run();
      db.prepare(
        "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', 'ta')"
      ).run(lastInsertRowid);
    });

    afterEach(() => db.close());

    it('should read the tags of an MPD song from its file', async () => {
      const result = await songNotice(
        {
          player: { source: 'mpd', name: 'MPD' },
          track: { file: '/music/a.mp3', title: 'A', artist: 'X', album: 'Y' }
        },
        deps()
      );
      expect(result).to.deep.include({
        source: 'MPD',
        title: 'A',
        rating: '4.0',
        inLibrary: true,
        cover: '/music/a.mp3.jpg'
      });
    });

    it('should find the library song of a Spotify track, else use its own cover', async () => {
      const spotify = { source: 'spotify', name: 'Spotify' };
      const linked = await songNotice(
        { player: spotify, track: { trackId: 'ta', title: 'A' } },
        deps()
      );
      expect(linked).to.deep.include({ rating: '4.0', inLibrary: true });
      const remote = await songNotice(
        { player: spotify, track: { trackId: 'tz', title: 'Z', artUrl: 'https://i/z' } },
        deps()
      );
      expect(remote).to.deep.include({
        rating: null,
        inLibrary: false,
        meta: null,
        cover: 'https://i/z'
      });
      const noDb = await songNotice(
        { player: spotify, track: { trackId: 'ta', title: 'A' } },
        { ...deps(), openDb: () => null }
      );
      expect(noDb.inLibrary).to.equal(false);
    });

    it('should find the library song of a Spotify local file by its tags', async () => {
      db.prepare("UPDATE songs SET duration = 200 WHERE path = 'a.mp3'").run();
      const tag = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (1, ?, ?)');
      tag.run('TIT2', 'A');
      tag.run('TPE1', 'X');
      const spotify = { source: 'spotify', name: 'Spotify' };
      const local = { trackId: null, local: true, title: 'A', artist: 'X', duration: 201 };
      const found = await songNotice({ player: spotify, track: local }, deps());
      expect(found).to.deep.include({ rating: '4.0', inLibrary: true, cover: '/music/a.mp3.jpg' });
      const stray = await songNotice(
        { player: spotify, track: { ...local, title: 'Elsewhere' } },
        deps()
      );
      expect(stray.inLibrary).to.equal(false);
    });
  });

  describe('createNotifier', () => {
    it('should run onTrack once per new track before notifying, and notify when it fails', async () => {
      const seen = [];
      const sent = [];
      let track = { trackId: 'a', title: 'A' };
      const player = {
        source: 'spotify',
        name: 'Spotify',
        state: async () => ({ state: 'playing', track })
      };
      const notifier = createNotifier({
        describe: async ({ track: t }) => ({ title: t.title }),
        send: async notice => {
          sent.push(notice.title);
          return 1;
        },
        onTrack: async ({ status }) => {
          seen.push(status.track.trackId);
          if (status.track.trackId === 'b') {
            throw new Error('Web API down');
          }
        }
      });
      await notifier.check(player);
      await notifier.check(player);
      track = { trackId: 'b', title: 'B' };
      await notifier.check(player);
      expect(seen).to.deep.equal(['a', 'b']);
      expect(sent).to.deep.equal(['A', 'B']);
    });

    // a player whose state is set by the test
    const fakePlayer = (source, state) => ({
      source,
      name: source,
      current: state,
      state: async function () {
        return this.current;
      }
    });

    it('should notify once per new track while playing, replacing the last notification', async () => {
      const sent = [];
      let id = 0;
      const notifier = createNotifier({
        describe: async ({ player, track }) => ({ source: player.name, title: track.title }),
        send: async (shown, replaceId) => {
          sent.push([shown.title, replaceId]);
          id += 1;
          return `${id}`;
        }
      });
      const mpd = fakePlayer('mpd', { state: 'playing', track: { file: '/a.mp3', title: 'A' } });
      const spotify = fakePlayer('spotify', {
        state: 'paused',
        track: { trackId: 't1', title: 'S' }
      });
      await notifier.check(mpd);
      // the same track again (seek, volume, resume) and a paused player change nothing
      await notifier.check(mpd);
      await notifier.check(spotify);
      mpd.current = { state: 'playing', track: { file: '/b.mp3', title: 'B' } };
      await notifier.check(mpd);
      spotify.current = { state: 'playing', track: { trackId: 't1', title: 'S' } };
      await notifier.check(spotify);
      mpd.current = { state: 'stopped', track: null };
      await notifier.check(mpd);
      expect(sent).to.deep.equal([
        ['A', null],
        ['B', '1'],
        ['S', '2']
      ]);
    });

    it('should run checks one at a time so two events for one track notify once', async () => {
      const sent = [];
      const notifier = createNotifier({
        describe: async ({ track }) => ({ title: track.title }),
        send: async shown => {
          sent.push(shown.title);
          return null;
        }
      });
      const player = fakePlayer('spotify', {
        state: 'playing',
        track: { trackId: 't', title: 'T' }
      });
      await Promise.all([notifier.check(player), notifier.check(player)]);
      expect(sent).to.deep.equal(['T']);
    });

    it('should log a failed check and keep going', async () => {
      const notifier = createNotifier({
        describe: async () => {
          throw new Error('no tags');
        },
        send: async () => null
      });
      const player = fakePlayer('mpd', { state: 'playing', track: { file: '/a.mp3' } });
      expect(await notifier.check(player)).to.equal(null);
    });

    it('should key tracks by player and id or file', () => {
      expect(trackKey('spotify', { trackId: 't' })).to.equal('spotify:t');
      expect(trackKey('mpd', { file: '/a.mp3' })).to.equal('mpd:/a.mp3');
      expect(trackKey('mpd', null)).to.equal(null);
    });
  });

  describe('sendNotification', () => {
    it('should resolve to the id notify-send prints, or null when it fails', async () => {
      const calls = [];
      const ok = (bin, args, cb) => {
        calls.push([bin, args]);
        cb(null, '17\n');
      };
      expect(await sendNotification(notice, daemon, '3', { execFile: ok })).to.equal('17');
      expect(calls[0][1]).to.include('--replace-id=3');
      const fail = (bin, args, cb) => cb(new Error('no server'));
      expect(await sendNotification(notice, daemon, null, { execFile: fail })).to.equal(null);
    });
  });

  describe('watchSpotify', () => {
    // a spawn of playerctl --follow whose output lines and exit the test drives
    const fakeSpawn = () => {
      const children = [];
      const spawn = (bin, args) => {
        const child = new EventEmitter();
        child.args = [bin, ...args];
        child.stdout = new EventEmitter();
        child.stdout.resume = () => {};
        child.stdout.pause = () => {};
        child.kill = () => child.emit('close', null);
        children.push(child);
        return child;
      };
      return { children, spawn };
    };

    it('should call onChange once per burst of metadata lines, and restart playerctl when it exits', async () => {
      const { children, spawn } = fakeSpawn();
      let changes = 0;
      const stop = watchSpotify(
        () => {
          changes += 1;
        },
        { spawn, settle: 5, restart: 1 }
      );
      expect(children[0].args).to.deep.equal([
        'playerctl',
        '-p',
        'spotify',
        '--follow',
        'metadata',
        '--format',
        '{{xesam:url}}'
      ]);
      const write = text => children[children.length - 1].stdout.emit('data', Buffer.from(text));
      write('https://open.spotify.com/track/a\nhttps://open.spotify.com/track/a\n\n');
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(changes).to.equal(1);
      children[0].emit('close', 0);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(children).to.have.length(2);
      stop();
      expect(children).to.have.length(2);
    });
  });

  describe('watchMpd', () => {
    // an MPD client emitting idle events, closed by the test
    const fakeClient = () => {
      const client = new EventEmitter();
      client.socket = new EventEmitter();
      client.socket.destroy = () => client.socket.emit('close');
      return client;
    };

    it('should report player events, and reconnect after a failure or a dropped connection', async () => {
      const clients = [];
      let attempts = 0;
      const connect = async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('connection refused');
        }
        const client = fakeClient();
        clients.push(client);
        return client;
      };
      let changes = 0;
      const stop = await watchMpd(
        { host: 'localhost', port: 6600 },
        () => {
          changes += 1;
        },
        { connect, waits: [1] }
      );
      await new Promise(resolve => setTimeout(resolve, 10));
      // connected on the second try, checked once on connecting
      expect(clients).to.have.length(1);
      expect(changes).to.equal(1);
      clients[0].emit('system', 'player');
      clients[0].emit('system', 'mixer');
      expect(changes).to.equal(2);
      clients[0].socket.emit('close');
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(clients).to.have.length(2);
      expect(changes).to.equal(3);
      await stop();
      expect(attempts).to.equal(3);
    });
  });

  describe('watchSongs', () => {
    it('should check Spotify at once and on each change, and MPD through its watcher', async () => {
      const checked = [];
      const player = source => ({
        source,
        name: source,
        state: async () => {
          checked.push(source);
          return { state: 'paused', track: null };
        }
      });
      let spotifyChange;
      let mpdChange;
      let stops = 0;
      const stop = await watchSongs(
        { mpd: { host: 'h', port: 1 }, daemon },
        {
          players: { mpd: player('mpd'), spotify: player('spotify') },
          openDb: () => null,
          readSong: async () => null,
          send: async () => null,
          spotifyWatcher: onChange => {
            spotifyChange = onChange;
            return () => {
              stops += 1;
            };
          },
          mpdWatcher: async (mpdConfig, onChange) => {
            mpdChange = onChange;
            return async () => {
              stops += 1;
            };
          }
        }
      );
      spotifyChange();
      mpdChange();
      await tick();
      await tick();
      expect(checked).to.deep.equal(['spotify', 'spotify', 'mpd']);
      await stop();
      expect(stops).to.equal(2);
    });
  });
});
