const { expect } = require('chai');

const { describeState, parseArgs, parseSeek, parseVolume, run } = require('./player.js');
const { getMeta, openDatabase, setMeta } = require('../db/database.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { backKey } = require('../player/back.js');
const { backFile } = require('../player/backFile.js');

describe('Player command', () => {
  const config = { mpd: { baseDirectory: '/music' } };
  const track = { title: 'Song', artist: 'Artist', position: 61, duration: 200 };

  // a player with a fixed state that records the controls used
  const fakePlayer = (source, state, extra = {}) => {
    const calls = [];
    const record =
      name =>
      async (...args) => {
        calls.push([name, ...args]);
      };
    return {
      calls,
      source,
      name: source === 'mpd' ? 'MPD' : 'Spotify',
      state: async () => ({
        state,
        volume: 50,
        shuffle: false,
        repeat: 'off',
        track: state ? track : null,
        ...extra
      }),
      ...Object.fromEntries(
        [
          'toggle',
          'play',
          'pause',
          'stop',
          'next',
          'prev',
          'seek',
          'seekTo',
          'volume',
          'setVolume',
          'shuffle',
          'repeat'
        ].map(name => [name, record(name)])
      ),
      queue: async count => ({
        length: 5,
        current: 2,
        tracks: [{ position: 3, title: 'Next', artist: 'A', duration: 90 }].slice(0, count)
      })
    };
  };

  const songs = [
    ['/music/a.mp3', { title: 'A', sp_track_id: 'ta' }],
    ['/music/b.mp3', { title: 'B' }],
    ['/music/c.mp3', { title: 'C', sp_track_id: 'tc' }]
  ];

  // runs the command with fakes, recording queued MPD songs, played Spotify ids and Web API requests
  const runWith = async (terms, players, extra = {}) => {
    const queued = [];
    const played = [];
    const requests = [];
    const result = await run({
      options: { terms },
      config,
      players,
      settle: 0,
      find: async ({ terms: searched }) => (searched.includes('none') ? [] : songs),
      queue: async (mpdConfig, paths, options) => {
        queued.push([paths, options]);
        return paths.length;
      },
      play: async (client, ids) => {
        played.push(ids);
        return { device: 'charon', count: ids.length };
      },
      client: () => ({
        request: async (method, url) => requests.push([method, url]),
        get: async () => ({
          queue: [{ name: 'Up', artists: [{ name: 'X' }, { name: 'Y' }], duration_ms: 125000 }]
        })
      }),
      ...extra
    });
    return { result, queued, played, requests };
  };

  describe('parseArgs', () => {
    it('should read the player, the action and its arguments, status by default', () => {
      expect(parseArgs([])).to.deep.equal({ source: null, action: 'status', args: [] });
      expect(parseArgs(['MPD', 'seek', '-30'])).to.deep.equal({
        source: 'mpd',
        action: 'seek',
        args: ['-30']
      });
      expect(parseArgs(['volume', '+5']).action).to.equal('vol');
      expect(parseArgs(['previous']).action).to.equal('prev');
      expect(parseArgs(['play', 'context:Study']).args).to.deep.equal(['context:Study']);
    });

    it('should refuse unknown actions and values they do not take', () => {
      expect(() => parseArgs(['skip'])).to.throw("Unknown action 'skip'");
      expect(() => parseArgs(['seek', 'later'])).to.throw('seek takes +seconds');
      expect(() => parseArgs(['vol', '150'])).to.throw('vol takes');
      expect(() => parseArgs(['shuffle', 'smart'])).to.throw('shuffle takes on, off, or toggle');
      expect(() => parseArgs(['repeat', 'all'])).to.throw('repeat takes off, playlist, track');
      expect(() => parseArgs(['queue', 'all'])).to.throw('queue takes a count');
      expect(() => parseArgs(['add'])).to.throw('add needs search terms');
    });

    it('should read relative and absolute seek positions and volumes', () => {
      expect(parseSeek('+30')).to.deep.equal({ relative: 30 });
      expect(parseSeek('-30')).to.deep.equal({ relative: -30 });
      expect(parseSeek('90')).to.deep.equal({ absolute: 90 });
      expect(parseSeek('1:30')).to.deep.equal({ absolute: 90 });
      expect(() => parseSeek('1:75')).to.throw();
      expect(parseVolume('-5')).to.deep.equal({ relative: -5 });
      expect(parseVolume('40')).to.deep.equal({ absolute: 40 });
    });
  });

  describe('controls', () => {
    it('should act on the active player, Spotify when both play, and show its state', async () => {
      const spotify = fakePlayer('spotify', 'playing');
      const mpd = fakePlayer('mpd', 'playing');
      const { result } = await runWith(['next'], [spotify, mpd]);
      expect(spotify.calls).to.deep.equal([['next']]);
      expect(mpd.calls).to.be.empty;
      expect(result).to.include({ source: 'spotify', action: 'next', state: 'playing' });
    });

    it('should act on the player named first, and refuse one that is not running', async () => {
      const spotify = fakePlayer('spotify', 'playing');
      const mpd = fakePlayer('mpd', 'stopped');
      await runWith(['mpd', 'play'], [spotify, mpd]);
      expect(mpd.calls).to.deep.equal([['play']]);
      await runWith(['spotify', 'vol', '+5'], [fakePlayer('spotify', null), mpd]).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('Spotify is not running')
      );
    });

    it('should act on Spotify on another device when the desktop app is not running', async () => {
      const remote = { ...fakePlayer('spotify', 'playing'), remote: true };
      const mpd = fakePlayer('mpd', 'playing');
      // MPD plays, so choosing the active player leaves the remote one out; naming Spotify asks it
      await runWith(['spotify', 'next'], [fakePlayer('spotify', null), mpd, remote]);
      expect(remote.calls).to.deep.equal([['next']]);
      expect(mpd.calls).to.deep.equal([]);
      await runWith(['pause'], [fakePlayer('spotify', null), fakePlayer('mpd', 'stopped'), remote]);
      expect(remote.calls).to.deep.equal([['next'], ['pause']]);
    });

    it('should seek and set the volume relatively or absolutely, and step repeat', async () => {
      const mpd = fakePlayer('mpd', 'paused');
      await runWith(['seek', '-30'], [mpd]);
      await runWith(['seek', '1:30'], [mpd]);
      await runWith(['vol', '+5'], [mpd]);
      await runWith(['vol', '40'], [mpd]);
      await runWith(['shuffle', 'toggle'], [mpd]);
      await runWith(['repeat', 'next'], [mpd]);
      expect(mpd.calls).to.deep.equal([
        ['seek', -30],
        ['seekTo', 90],
        ['volume', 5],
        ['setVolume', 40],
        ['shuffle', 'toggle'],
        ['repeat', 'playlist']
      ]);
    });

    it('should show the status without sending anything, and fail when nothing runs', async () => {
      const mpd = fakePlayer('mpd', 'stopped');
      const { result } = await runWith([], [fakePlayer('spotify', null), mpd]);
      expect(result).to.include({ source: 'mpd', action: 'status', state: 'stopped' });
      expect(mpd.calls).to.be.empty;
      await runWith(['next'], [fakePlayer('spotify', null), fakePlayer('mpd', null)]).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('Neither MPD nor Spotify is running')
      );
    });

    it('should describe a player state in one line', () => {
      expect(
        describeState(
          { name: 'Spotify' },
          { state: 'playing', track, volume: 80, shuffle: true, repeat: 'track' }
        )
      ).to.equal(
        'Spotify playing  ·  Artist - Song  ·  1:01 / 3:20  ·  vol 80%  ·  shuffle on  ·  repeat track'
      );
      expect(describeState({ name: 'MPD' }, { state: 'stopped', volume: null })).to.equal(
        'MPD stopped'
      );
    });
  });

  describe('play and add search results', () => {
    it('should play songs in MPD when no player is active, replacing the queue', async () => {
      const mpd = fakePlayer('mpd', 'stopped');
      const spotify = fakePlayer('spotify', null);
      const { queued, result } = await runWith(['play', 'context:Study'], [spotify, mpd]);
      expect(queued).to.deep.equal([[['a.mp3', 'b.mp3', 'c.mp3'], { replace: true }]]);
      expect(result.result).to.deep.equal({ source: 'mpd', count: 3 });
    });

    it('should add songs to the MPD queue', async () => {
      const { queued } = await runWith(['mpd', 'add', 'rating:5'], [fakePlayer('mpd', 'playing')]);
      expect(queued[0][1]).to.deep.equal({ replace: false });
    });

    it('should play the Spotify ids of songs on the active Spotify, leaving out songs without one', async () => {
      const spotify = fakePlayer('spotify', 'paused');
      const mpd = fakePlayer('mpd', 'stopped');
      const { played, queued, result } = await runWith(['play', 'mood:Mellow'], [spotify, mpd]);
      expect(played).to.deep.equal([['ta', 'tc']]);
      expect(queued).to.be.empty;
      expect(result.result).to.deep.equal({ source: 'spotify', count: 2, device: 'charon' });
    });

    it('should add songs to the Spotify queue one track at a time', async () => {
      const { requests } = await runWith(
        ['spotify', 'add', 'mood:Mellow'],
        [fakePlayer('spotify', 'playing')]
      );
      expect(requests).to.deep.equal([
        ['POST', '/me/player/queue?uri=spotify%3Atrack%3Ata'],
        ['POST', '/me/player/queue?uri=spotify%3Atrack%3Atc']
      ]);
    });

    it('should fail when no song matches, or none has a Spotify id', async () => {
      await runWith(['play', 'none'], [fakePlayer('mpd', 'stopped')]).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('No songs match none')
      );
      await runWith(['spotify', 'play', 'x'], [fakePlayer('spotify', 'playing')], {
        find: async () => [songs[1]]
      }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('None of the 1 matching song has a Spotify id')
      );
    });
  });

  describe('queue', () => {
    it('should list the MPD queue after the song playing', async () => {
      const { result } = await runWith(['queue', '1'], [fakePlayer('mpd', 'playing')]);
      expect(result).to.deep.equal({
        source: 'mpd',
        length: 5,
        tracks: [{ position: 3, title: 'Next', artist: 'A', duration: 90 }]
      });
    });

    it('should list the Spotify queue from the Web API', async () => {
      const { result } = await runWith(['queue'], [fakePlayer('spotify', 'playing')]);
      expect(result).to.deep.equal({
        source: 'spotify',
        tracks: [{ title: 'Up', artist: 'X, Y', duration: 125 }]
      });
    });
  });

  describe('back', () => {
    let db;
    beforeEach(() => {
      db = openDatabase(':memory:');
    });
    afterEach(() => db.close());
    // the in-memory database, kept open when the command closes it
    const openDb = () => ({ prepare: sql => db.prepare(sql), close: () => {} });
    const snapshot = { files: ['main.mp3'], position: 0, elapsed: 61, modes: { random: '1' } };
    const mpdWith = (state, file, extra = {}) => {
      const player = fakePlayer('mpd', state, {
        track: { ...track, file: `/music/${file}` }
      });
      player.snapshot = async () => snapshot;
      player.restore = async point => {
        player.calls.push(['restore', point]);
        return { count: point.files.length, skipped: 0, position: point.position };
      };
      return Object.assign(player, extra);
    };

    it('should remember the MPD queue before play replaces it, and go back to it', async () => {
      const mpd = mpdWith('playing', 'main.mp3');
      await runWith(['play', 'artist:Radiohead'], [mpd], { openDb });
      expect(getMeta(db, backKey)).to.include({ source: 'mpd' });
      expect(getMeta(db, backKey).side).to.deep.equal({
        source: 'mpd',
        ids: ['/music/a.mp3', '/music/b.mp3', '/music/c.mp3']
      });
      const { result } = await runWith(['back'], [mpd], { openDb });
      expect(mpd.calls).to.deep.include(['restore', snapshot]);
      expect(result).to.include({ source: 'mpd', action: 'back' });
      expect(result.result).to.include({ count: 1, position: 0 });
      expect(getMeta(db, backKey)).to.equal(null);
    });

    it('should return to the main list after several side trips in a row', async () => {
      await runWith(['play', 'artist:Radiohead'], [mpdWith('playing', 'main.mp3')], { openDb });
      const onSide = mpdWith('playing', 'b.mp3', {
        snapshot: async () => ({ files: ['a.mp3', 'b.mp3', 'c.mp3'], position: 1 })
      });
      await runWith(['play', 'artist:Portishead'], [onSide], { openDb });
      expect(getMeta(db, backKey).mpd).to.deep.equal(snapshot);
    });

    it('should not remember anything for add, or when the songs fail to play', async () => {
      await runWith(['add', 'artist:Radiohead'], [mpdWith('playing', 'main.mp3')], { openDb });
      await runWith(['play', 'none'], [mpdWith('playing', 'main.mp3')], { openDb }).catch(
        () => null
      );
      expect(getMeta(db, backKey)).to.equal(null);
    });

    it('should play the side trip even when what played cannot be read', async () => {
      const mpd = mpdWith('playing', 'main.mp3', {
        snapshot: async () => {
          throw new Error('MPD went away');
        }
      });
      const { queued } = await runWith(['play', 'artist:Radiohead'], [mpd], { openDb });
      expect(queued).to.have.length(1);
      expect(getMeta(db, backKey)).to.equal(null);
    });

    it('should fail with nothing to go back to, and without a database', async () => {
      await runWith(['back'], [mpdWith('playing', 'main.mp3')], { openDb }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.match(/^Nothing to go back to/)
      );
      await runWith(['back'], [mpdWith('playing', 'main.mp3')]).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.match(/^No library database/)
      );
    });

    it('should leave the back point alone without a database', async () => {
      setMeta(db, backKey, null);
      const { queued } = await runWith(
        ['play', 'artist:Radiohead'],
        [mpdWith('playing', 'main.mp3')]
      );
      expect(queued).to.have.length(1);
    });
  });

  describe('switches', () => {
    // runs with switches, the terms after the action as given
    const runSwitches = (terms, switches, players, extra = {}) =>
      runWith(terms, players, { options: { terms, switches }, ...extra });

    it('should refuse switches that do not go with the action', () => {
      const { checkSwitches } = require('./player.js');
      expect(() => checkSwitches('next', [], { shuffle: true })).to.throw(
        '--shuffle goes with play or add'
      );
      expect(() => checkSwitches('add', ['x'], { main: true })).to.throw('--main goes with play');
      expect(() => checkSwitches('play', [], { peek: true })).to.throw('--peek goes with back');
      expect(() => checkSwitches('back', [], { path: true })).to.throw(
        '--path goes with back --peek'
      );
      expect(() => checkSwitches('play', ['rating:5'], { files: true })).to.throw(
        /not search terms/
      );
      expect(() =>
        checkSwitches('play', ['-'], { files: true, shuffle: true, main: true })
      ).to.not.throw();
    });

    it('should play search results in random order with --shuffle', async () => {
      const { queued } = await runSwitches(
        ['play', 'rating:5'],
        { shuffle: true },
        [fakePlayer('mpd', 'stopped')],
        { random: () => 0 }
      );
      expect(queued[0][0]).to.deep.equal(['b.mp3', 'c.mp3', 'a.mp3']);
    });

    it('should play the files on stdin in order on MPD, leaving out unknown ones', async () => {
      const { queued, result } = await runSwitches(
        ['play', '-'],
        { files: true },
        [fakePlayer('mpd', 'playing'), fakePlayer('spotify', null)],
        {
          readInput: async () => 'z.mp3\n\n/music/y.mp3\nmissing.mp3\n../outside.mp3\n',
          exists: file => file !== '/music/missing.mp3'
        }
      );
      expect(queued).to.deep.equal([[['z.mp3', 'y.mp3'], { replace: true }]]);
      expect(result.result).to.deep.equal({ source: 'mpd', count: 2 });
    });

    it('should refuse --files on Spotify, and with nothing usable on stdin', async () => {
      const reject = async (promise, message) =>
        promise.then(
          () => expect.fail('should reject'),
          err => expect(err.message).to.match(message)
        );
      await reject(
        runSwitches(['spotify', 'play', '-'], { files: true }, [fakePlayer('spotify', 'playing')]),
        /on MPD only/
      );
      await reject(
        runSwitches(['play'], { files: true }, [
          fakePlayer('spotify', 'playing'),
          fakePlayer('mpd', 'stopped')
        ]),
        /^Spotify is playing/
      );
      await reject(
        runSwitches(['play'], { files: true }, [fakePlayer('mpd', 'stopped')], {
          readInput: async () => '\n'
        }),
        /got none/
      );
      await reject(
        runSwitches(['add'], { files: true }, [fakePlayer('mpd', 'stopped')], {
          readInput: async () => 'gone.mp3',
          exists: () => false
        }),
        /^None of the 1 path/
      );
    });
  });

  describe('back point published and peeked', () => {
    let db;
    let runtime;
    let env;
    beforeEach(() => {
      db = openDatabase(':memory:');
      runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-back-'));
      env = { XDG_RUNTIME_DIR: runtime };
    });
    afterEach(() => {
      db.close();
      fs.rmSync(runtime, { recursive: true, force: true });
    });
    const openDb = () => ({ prepare: sql => db.prepare(sql), close: () => {} });
    const mpd = file => {
      const player = fakePlayer('mpd', 'playing', { track: { ...track, file: `/music/${file}` } });
      player.snapshot = async () => ({ files: [file], position: 0, elapsed: 1, modes: {} });
      player.restore = async () => ({ count: 1, skipped: 0, position: 0 });
      return player;
    };
    const output = () => {
      const chunks = [];
      return { chunks, write: text => chunks.push(text) };
    };

    it('should publish the back point when play saves it and remove it on back', async () => {
      await runWith(['play', 'artist:Radiohead'], [mpd('main.mp3')], { openDb, env });
      const lines = fs.readFileSync(backFile(env), 'utf8').split('\n');
      expect(lines.slice(0, 3)).to.deep.equal(['mpd', 'Artist', 'Song']);
      expect(lines[3]).to.match(/^\d{4}-\d\d-\d\dT/);
      await runWith(['back'], [mpd('a.mp3')], { openDb, env });
      expect(fs.existsSync(backFile(env))).to.equal(false);
    });

    it('should forget the back point with --main, saving nothing', async () => {
      await runWith(['play', 'artist:Radiohead'], [mpd('main.mp3')], { openDb, env });
      await runWith(['play', 'context:Study'], [mpd('a.mp3')], {
        options: { terms: ['play', 'context:Study'], switches: { main: true } },
        openDb,
        env
      });
      expect(getMeta(db, backKey)).to.equal(null);
      expect(fs.existsSync(backFile(env))).to.equal(false);
    });

    it('should print the back point with --peek, as text or JSON, and publish it again', async () => {
      setMeta(db, backKey, {
        source: 'spotify',
        savedAt: '2026-11-14T10:00:00.000Z',
        track: { artist: 'Band', title: 'Main' }
      });
      const text = output();
      await runWith(['back'], [], {
        options: { terms: ['back'], switches: { peek: true } },
        openDb,
        env,
        out: text
      });
      expect(text.chunks.join('')).to.equal('spotify\nBand\nMain\n2026-11-14T10:00:00.000Z\n');
      expect(fs.readFileSync(backFile(env), 'utf8')).to.equal(text.chunks.join(''));
      const json = output();
      const { result } = await runWith(['back'], [], {
        options: { terms: ['back'], switches: { peek: true, format: 'json' } },
        openDb,
        env,
        out: json
      });
      expect(JSON.parse(json.chunks.join(''))).to.deep.equal({
        source: 'spotify',
        artist: 'Band',
        title: 'Main',
        savedAt: '2026-11-14T10:00:00.000Z'
      });
      expect(result).to.deep.equal(JSON.parse(json.chunks.join('')));
    });

    it('should fail --peek without a back point, and print the path with --path', async () => {
      await runWith(['back'], [], {
        options: { terms: ['back'], switches: { peek: true } },
        openDb,
        env,
        out: output()
      }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.match(/^No back point/)
      );
      const out = output();
      await runWith(['back'], [], {
        options: { terms: ['back'], switches: { peek: true, path: true } },
        env,
        out
      });
      expect(out.chunks.join('')).to.equal(`${path.join(runtime, 'musicman', 'back')}\n`);
    });
  });
});
