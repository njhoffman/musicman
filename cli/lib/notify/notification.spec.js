const { expect } = require('chai');
const { EventEmitter } = require('events');

const { openDatabase } = require('../db/database.js');
const { barDefaults, glyphs } = require('../status/bar.js');
const {
  buildNotification,
  createNotifier,
  titleEnd,
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
  player: 'spotify',
  title: 'Fade Into You',
  artist: 'Mazzy Star',
  album: 'So Tonight',
  rating: '4.5',
  inLibrary: true,
  meta: { rating: '4.5', context: 'Study,Drive,', mood: 'Mellow', picks: 'Nick' },
  cover: '/covers/a.jpg',
  liked: false
};

const { colors } = barDefaults;
const paint = (color, glyph) =>
  `<span font_family="FiraCode Nerd Font Mono" foreground="${color}">${glyph}</span>`;

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('Notify Daemon', () => {
  describe('buildNotification', () => {
    it('should show the title, artist and album, colored tags, musicman with the player and the cover', () => {
      const { bin, args } = buildNotification(notice, daemon);
      expect(bin).to.equal('/usr/bin/notify-send');
      expect(args.slice(0, 7)).to.deep.equal([
        '--urgency=low',
        '--expire-time=5000',
        '--app-name=musicman',
        '--print-id',
        '--hint=string:x-musicman-player:spotify',
        `--hint=string:x-notifyd-title-end:${paint(colors.star, glyphs.starFilled)} 4.5`,
        '--hint=string:image-path:file:///covers/a.jpg'
      ]);
      expect(args[7]).to.equal('Fade Into You');
      const [artist, tags] = args[8].split('\n');
      expect(artist).to.equal('<b>Mazzy Star</b>  ·  So Tonight');
      expect(tags.match(/> (\w+) </g)).to.deep.equal(['> Study <', '> Drive <', '> Mellow <']);
      // picks is not in daemon.fields
      expect(tags).to.not.include('Nick');
    });

    it('should leave the display time to the notification server without daemon.duration', () => {
      const { args } = buildNotification(notice, { ...daemon, duration: undefined });
      expect(args.some(arg => arg.startsWith('--expire-time'))).to.equal(false);
    });

    it('should color the heart and star with the given bar colors', () => {
      const custom = { ...colors, heart: '#f00', star: '#0f0' };
      const { args } = buildNotification({ ...notice, liked: true }, daemon, null, custom);
      expect(args).to.include(
        `--hint=string:x-notifyd-title-end:${paint('#f00', glyphs.heart)} ${paint(
          '#0f0',
          glyphs.starFilled
        )} 4.5`
      );
    });

    it('should replace the last notification and leave out the cover when icon is off', () => {
      const { args } = buildNotification(notice, { ...daemon, icon: false }, '42');
      expect(args).to.include('--replace-id=42');
      expect(args.some(arg => /^--icon|^--hint=string:image-path/.test(arg))).to.equal(false);
    });

    it('should leave out the cover when there is none', () => {
      const { args } = buildNotification({ ...notice, cover: null }, daemon);
      expect(args.some(arg => /^--icon|^--hint=string:image-path/.test(arg))).to.equal(false);
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

  describe('titleEnd', () => {
    const star = (color, glyph) => paint(colors[color], glyphs[glyph]);

    it("should draw the bar's star with the number: gold at 5, filled from 4.5, outlines below", () => {
      const song = rating => titleEnd({ inLibrary: true, rating });
      expect(song('5.0')).to.equal(`${star('gold', 'starFilled')} 5.0`);
      expect(song('4.5')).to.equal(`${star('star', 'starFilled')} 4.5`);
      expect(song('4')).to.equal(`${star('star', 'starOutline')} 4.0`);
      expect(song(3.5)).to.equal(`${star('low', 'starOutline')} 3.5`);
    });

    it('should show a gray star without a number for unrated songs, nothing outside the library', () => {
      expect(titleEnd({ inLibrary: true, rating: null })).to.equal(star('unrated', 'starFilled'));
      expect(titleEnd({ inLibrary: true, rating: 'abc' })).to.equal(star('unrated', 'starFilled'));
      expect(titleEnd({ inLibrary: false, rating: null })).to.equal('');
    });

    it('should put the heart first for a liked song, in or out of the library', () => {
      const heart = paint(colors.heart, glyphs.heart);
      expect(titleEnd({ inLibrary: true, rating: '4.5', liked: true })).to.equal(
        `${heart} ${star('star', 'starFilled')} 4.5`
      );
      expect(titleEnd({ inLibrary: false, liked: true })).to.equal(heart);
    });

    it('should draw the glyphs in daemon.glyphFont, or the daemon font when it is empty', () => {
      const song = { ...notice, liked: true };
      const end = daemonConfig =>
        buildNotification(song, daemonConfig).args.find(arg => arg.includes('x-notifyd-title-end'));
      expect(end({ ...daemon, glyphFont: 'Symbols Nerd Font' })).to.include(
        '<span font_family="Symbols Nerd Font" foreground="#ff8fc7">'
      );
      expect(end({ ...daemon, glyphFont: '' })).to.include('<span foreground="#ff8fc7">');
      expect(end({ ...daemon, glyphFont: '' })).to.not.include('font_family');
    });

    it('should leave the title-end hint out when there is nothing to show', () => {
      const { args } = buildNotification({ ...notice, inLibrary: false, meta: null }, daemon);
      expect(args.some(arg => arg.includes('x-notifyd-title-end'))).to.equal(false);
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

    it('should name the Spotify album of a single played from MPD', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-notice-'));
      try {
        fs.writeFileSync(path.join(dir, 'beets.yaml'), 'paths:\n  default: $title\n');
        tags['/music/a.mp3'].sp_album = 'Real Album';
        const result = await songNotice(
          {
            player: { source: 'mpd', name: 'MPD' },
            track: { file: '/music/a.mp3', title: 'A', artist: 'X', album: 'Handpicked Y' }
          },
          { ...deps(), config: { ...config, sync: { beetsConfig: path.join(dir, 'beets.yaml') } } }
        );
        expect(result.album).to.equal('Real Album');
      } finally {
        delete tags['/music/a.mp3'].sp_album;
        fs.rmSync(dir, { recursive: true, force: true });
      }
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

    describe('the heart', () => {
      const mpdSong = {
        player: { source: 'mpd', name: 'MPD' },
        track: { file: '/music/a.mp3', title: 'A', artist: 'X' }
      };
      const cacheLiked = () => {
        db.prepare(
          "INSERT INTO spotify_playlists (id, name) VALUES ('liked', 'Liked Songs')"
        ).run();
        db.prepare(
          "INSERT INTO spotify_playlist_tracks (playlist_id, track_id) VALUES ('liked', 'ta')"
        ).run();
      };

      it('should go by the cached Liked Songs, by the id tagged on an MPD file', async () => {
        expect((await songNotice(mpdSong, deps())).liked).to.equal(false);
        cacheLiked();
        expect((await songNotice(mpdSong, deps())).liked).to.equal(true);
      });

      it("should take Spotify's answer for the file's id over the cache", async () => {
        cacheLiked();
        const asked = [];
        const liked = async id => {
          asked.push(id);
          return false;
        };
        expect((await songNotice(mpdSong, { ...deps(), liked })).liked).to.equal(false);
        expect(asked).to.deep.equal(['ta']);
        const spotify = {
          player: { source: 'spotify', name: 'Spotify' },
          track: { trackId: 'tz' }
        };
        const yes = await songNotice(spotify, { ...deps(), liked: async () => true });
        expect(yes).to.deep.include({ liked: true, inLibrary: false });
      });

      it('should keep the cached heart when Spotify fails, answers nothing usable, or is slow', async () => {
        cacheLiked();
        const failing = async () => {
          throw new Error('offline');
        };
        expect((await songNotice(mpdSong, { ...deps(), liked: failing })).liked).to.equal(true);
        expect((await songNotice(mpdSong, { ...deps(), liked: async () => null })).liked).to.equal(
          true
        );
        const slow = () => new Promise(resolve => setTimeout(() => resolve(false), 200));
        const started = Date.now();
        const late = await songNotice(mpdSong, { ...deps(), liked: slow, likedWait: 20 });
        expect(late.liked).to.equal(true);
        expect(Date.now() - started).to.be.below(150);
      });

      it('should not ask Spotify about a track without an id, using the local likes', async () => {
        const local = {
          player: { source: 'spotify', name: 'Spotify' },
          track: { trackId: null, local: true, title: 'Q', artist: 'R', duration: 100 }
        };
        const liked = async () => {
          throw new Error('not to be asked');
        };
        const likes = { has: tags => tags.title === 'Q' };
        expect((await songNotice(local, { ...deps(), liked, likes })).liked).to.equal(true);
        const unknown = { has: () => null };
        const confirmedLiked = () => true;
        expect(
          (await songNotice(local, { ...deps(), liked, likes: unknown, confirmedLiked })).liked
        ).to.equal(false);
      });
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
        '-a',
        '-p',
        'soloist,spotify,spotifyd',
        '--follow',
        'metadata',
        '--format',
        '{{playerName}} {{status}} {{xesam:url}}'
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
      let events = 0;
      const stop = await watchSongs(
        { mpd: { host: 'h', port: 1 }, daemon },
        {
          players: { mpd: player('mpd'), spotify: player('spotify') },
          openDb: () => null,
          readSong: async () => null,
          send: async () => null,
          onEvent: () => {
            events += 1;
          },
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
      expect(events).to.equal(2);
      await stop();
      expect(stops).to.equal(2);
    });
  });
});
