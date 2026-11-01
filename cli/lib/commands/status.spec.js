const { expect } = require('chai');
const { EventEmitter } = require('events');

const status = require('./status.js');
const shuffle = require('./shuffle.js');
const { openDatabase, setMeta } = require('../db/database.js');

const config = { mpd: { baseDirectory: '/music' }, db: { path: ':memory:' }, stats: {} };

// a player whose track changes to each of tracks in turn, one per state() call, then stays on the last
const player = (source, tracks) => {
  let call = 0;
  return {
    source,
    name: source === 'mpd' ? 'MPD' : 'Spotify',
    state: async () => {
      const track = tracks[Math.min(call, tracks.length - 1)];
      call += 1;
      return track ? { state: 'playing', track } : { state: 'stopped', track: null };
    }
  };
};

const fakeOut = (isTTY = true) => {
  const out = { isTTY, written: [] };
  out.write = text => out.written.push(text);
  return out;
};

// a terminal input that presses keys after a number of frames
const fakeInput = (isTTY = true) => {
  const input = new EventEmitter();
  input.isTTY = isTTY;
  input.raw = [];
  input.setRawMode = mode => input.raw.push(mode);
  input.resume = () => {};
  input.pause = () => {};
  return input;
};

describe('Status Command', () => {
  const spotifyTrack = { trackId: 't1', title: 'Song', artist: 'A', position: 1, duration: 10 };
  const run = (deps = {}) =>
    status.run({
      options: { switches: deps.switches || {} },
      config,
      db: deps.db || null,
      players: deps.players || [player('spotify', [spotifyTrack])],
      readSong: deps.readSong || (async () => null),
      contextOf: deps.contextOf || (async () => null),
      out: deps.out || fakeOut(),
      input: deps.input || fakeInput(),
      interval: 1
    });

  it('should print the status as JSON with --format json', async () => {
    const out = fakeOut();
    const result = await run({ out, switches: { format: 'json' } });
    expect(JSON.parse(out.written.join(''))).to.deep.equal(JSON.parse(JSON.stringify(result)));
    expect(result.player).to.deep.equal({ source: 'spotify', name: 'Spotify' });
  });

  it('should name the source of a musicman shuffle the track plays from', async () => {
    const db = openDatabase(':memory:');
    try {
      setMeta(db, shuffle.lastSourceKey, { terms: ['liked'], name: 'Liked Songs' });
      setMeta(db, shuffle.orderKey, ['t0', 't1']);
      const result = await run({ db, switches: { format: 'json' } });
      expect(result.from).to.deep.equal({ type: 'shuffle', name: 'Liked Songs', uri: null });
      const other = await run({
        db,
        switches: { format: 'json' },
        players: [player('spotify', [{ ...spotifyTrack, trackId: 'elsewhere' }])]
      });
      expect(other.from).to.equal(null);
    } finally {
      db.close();
    }
  });

  it('should refuse other formats, and --watch outside a terminal', async () => {
    await run({ switches: { format: 'csv' } }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.include('not csv')
    );
    await run({ switches: { watch: true }, out: fakeOut(false) }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.include('needs a terminal')
    );
  });

  it('should redraw with --watch until q, looking songs up again only when the track changes', async () => {
    const out = fakeOut();
    const input = fakeInput();
    const second = { ...spotifyTrack, trackId: 't2', title: 'Next' };
    const reads = [];
    const contexts = [];
    const frames = () => out.written.filter(text => text.startsWith('\u001b[H'));
    // q once the third frame is drawn
    const origWrite = out.write;
    out.write = text => {
      origWrite(text);
      if (frames().length === 3) {
        setImmediate(() => input.emit('data', 'q'));
      }
    };
    const result = await run({
      out,
      input,
      switches: { watch: true },
      players: [player('spotify', [spotifyTrack, spotifyTrack, second])],
      readSong: async file => reads.push(file),
      contextOf: async track => {
        contexts.push(track.trackId);
        return null;
      }
    });
    expect(frames()).to.have.length(3);
    expect(frames()[2]).to.include('Next');
    expect(contexts).to.deep.equal(['t1', 't2']);
    expect(input.raw).to.deep.equal([true, false]);
    expect(out.written[0]).to.equal('\u001b[?1049h\u001b[?25l');
    expect(out.written[out.written.length - 1]).to.equal('\u001b[?25h\u001b[?1049l');
    expect(result.track.title).to.equal('Next');
  });

  it('should make bare musicman the status screen only while a player plays or is paused', async () => {
    const playing = [player('spotify', [spotifyTrack])];
    const idle = [
      player('mpd', [null]),
      { source: 'spotify', name: 'Spotify', state: async () => ({ state: null }) }
    ];
    expect(await status.defaultArgs([], config, playing)).to.deep.equal(['status']);
    expect(await status.defaultArgs([], config, idle)).to.deep.equal([]);
    expect(await status.defaultArgs(['view'], config, playing)).to.deep.equal(['view']);
  });

  it('should report errors as one line from the command line', async () => {
    const exitCode = process.exitCode;
    const result = await status.func({
      options: { switches: { format: 'html' } },
      config,
      db: null,
      players: [],
      out: fakeOut()
    });
    expect(result.error).to.include('not html');
    process.exitCode = exitCode;
  });
});
