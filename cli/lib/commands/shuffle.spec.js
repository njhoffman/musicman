const { expect } = require('chai');
const _ = require('lodash');

const { getMeta, openDatabase, setMeta } = require('../db/database.js');
const shuffle = require('./shuffle.js');
const spotify = require('./spotify.js');

const config = {
  mpd: { baseDirectory: '/music' },
  db: { path: ':memory:' },
  library: { tags: [{ name: 'grouping' }, { name: 'mood' }] }
};

// a Spotify player recording the calls the commands make
const fakePlayer = (state = { state: 'playing', shuffle: true, repeat: 'off' }, { fail } = {}) => {
  const calls = [];
  let current = { ...state };
  const record =
    name =>
    async (...args) => {
      calls.push([name, ...args]);
      if (fail && fail === name) {
        throw new Error('No players found');
      }
      if (name === 'shuffle') {
        current = {
          ...current,
          shuffle: args[0] === 'toggle' ? !current.shuffle : args[0] === 'on'
        };
      }
      if (name === 'repeat') {
        current = { ...current, repeat: args[0] };
      }
    };
  return {
    calls,
    state: async () => current,
    shuffle: record('shuffle'),
    repeat: record('repeat'),
    open: record('open')
  };
};

// a Spotify client with Liked Songs a..e, one own playlist named musicman shuffle, recording writes;
// failPlayer makes the Web API player endpoints fail like a missing device; devices are the Spotify
// Connect devices; maxUris refuses play requests with more tracks (400)
const fakeClient = ({
  failPlayer = false,
  devices = [{ id: 'dev1', name: 'charon', is_active: false }],
  maxUris = Infinity
} = {}) => {
  const writes = [];
  return {
    writes,
    get: async url => {
      if (url === '/me') {
        return { id: 'me' };
      }
      return url === '/me/player/devices' ? { devices } : { name: 'Study' };
    },
    paginate: async url => {
      if (url.startsWith('/me/tracks')) {
        return _.map(['a', 'b', 'c', 'd', 'e'], id => ({ track: { id } }));
      }
      if (url.startsWith('/me/playlists')) {
        return [{ id: 'shuffleplaylist', name: 'musicman shuffle', owner: { id: 'me' } }];
      }
      return [];
    },
    request: async (method, url, body) => {
      writes.push([method, url, body]);
      if (failPlayer && url.startsWith('/me/player')) {
        throw Object.assign(new Error('No active device found (404)'), { status: 404 });
      }
      if (url.startsWith('/me/player/play') && body.uris.length > maxUris) {
        throw Object.assign(new Error('Too many ids (400)'), { status: 400 });
      }
      return {};
    }
  };
};

// track URIs written to playlists, in order
const uris = writes =>
  _.flatMap(
    _.filter(writes, ([, url]) => url.startsWith('/playlists/')),
    ([, , body]) => body.uris
  );
const playerWrites = writes => _.filter(writes, ([, url]) => url.startsWith('/me/player'));

describe('Shuffle Command', () => {
  let db;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  const runShuffle = (terms, deps = {}) =>
    shuffle.run({
      options: { terms, switches: deps.switches || {} },
      config,
      db,
      client: () => deps.client,
      player: deps.player || fakePlayer(),
      readLibrary: deps.readLibrary,
      random: () => 0,
      hostname: 'charon'
    });

  it('should write Liked Songs in random order to the shuffle playlist and play it from the first track', async () => {
    const client = fakeClient();
    const player = fakePlayer();
    const result = await runShuffle(['liked'], { client, player });
    expect(result).to.include({ written: true, playing: 'api', playlistId: 'shuffleplaylist' });
    expect(uris(client.writes)).to.deep.equal(
      _.map(['b', 'c', 'd', 'e', 'a'], id => `spotify:track:${id}`)
    );
    expect(client.writes[0].slice(0, 2)).to.deep.equal(['PUT', '/playlists/shuffleplaylist/items']);
    expect(playerWrites(client.writes)).to.deep.equal([
      ['PUT', '/me/player/shuffle?state=false&device_id=dev1', undefined],
      [
        'PUT',
        '/me/player/play?device_id=dev1',
        {
          uris: _.map(['b', 'c', 'd', 'e', 'a'], id => `spotify:track:${id}`),
          offset: { position: 0 },
          position_ms: 0
        }
      ]
    ]);
    expect(player.calls).to.be.empty;
    expect(getMeta(db, shuffle.lastSourceKey)).to.deep.equal({
      terms: ['liked'],
      name: 'Liked Songs'
    });
    expect(getMeta(db, shuffle.orderKey)).to.deep.equal(['b', 'c', 'd', 'e', 'a']);
  });

  it('should shuffle the last source again without one', async () => {
    setMeta(db, shuffle.lastSourceKey, { terms: ['liked'], name: 'Liked Songs' });
    const client = fakeClient();
    await runShuffle([], { client });
    expect(uris(client.writes)).to.have.length(5);
  });

  it('should ask for a source the first time', async () => {
    await runShuffle([], { client: fakeClient() }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.include('needs a source the first time')
    );
  });

  it('should read library filters from the library, not Spotify', async () => {
    const client = fakeClient();
    const readLibrary = async ({ terms }) => ({
      name: terms.join(' '),
      trackIds: ['x', 'y'],
      skipped: 1
    });
    await runShuffle(['rating:4.5', 'grouping:Dubstep.Singles'], { client, readLibrary });
    expect(uris(client.writes)).to.deep.equal(['spotify:track:y', 'spotify:track:x']);
    expect(getMeta(db, shuffle.lastSourceKey).name).to.equal('rating:4.5 grouping:Dubstep.Singles');
  });

  it('should write nothing in a dry run or for a source without Spotify tracks', async () => {
    const client = fakeClient();
    const player = fakePlayer();
    const dry = await runShuffle(['liked'], { client, player, switches: { dryRun: true } });
    expect(dry).to.include({ written: false });
    expect(dry.order).to.have.length(5);
    const empty = await runShuffle(['rating:5'], {
      client,
      player,
      readLibrary: async () => ({ name: 'rating:5', trackIds: [], skipped: 3 })
    });
    expect(empty).to.include({ written: false });
    expect(client.writes).to.be.empty;
    expect(player.calls).to.be.empty;
    expect(getMeta(db, shuffle.lastSourceKey)).to.equal(null);
  });

  it('should play on the active device, else the one named after this computer', async () => {
    const devices = [
      { id: 'phone', name: 'Pixel', is_active: false },
      { id: 'speaker', name: 'Kitchen', is_active: true },
      { id: 'dev1', name: 'charon', is_active: false }
    ];
    const active = fakeClient({ devices });
    await runShuffle(['liked'], { client: active });
    expect(playerWrites(active.writes)[1][1]).to.equal('/me/player/play?device_id=speaker');

    const none = fakeClient({ devices: [{ id: 'phone', name: 'Pixel', is_active: false }] });
    const player = fakePlayer();
    const result = await runShuffle(['liked'], { client: none, player });
    expect(result.playing).to.equal('mpris');
    expect(player.calls[1]).to.deep.equal(['open', 'spotify:playlist:shuffleplaylist']);
  });

  it('should halve the tracks started when Spotify refuses a long list', async () => {
    const client = fakeClient({ maxUris: 2 });
    const readLibrary = async () => ({
      name: 'rating:4',
      trackIds: _.map(_.range(300), i => `t${i}`),
      skipped: 0,
      total: 300
    });
    const result = await runShuffle(['rating:4'], { client, readLibrary });
    const plays = _.filter(client.writes, ([, url]) => url.startsWith('/me/player/play'));
    // 300 refused, 150 refused, then the floor of 100 is the last try and fails too
    expect(_.map(plays, ([, , body]) => body.uris.length)).to.deep.equal([300, 150, 100]);
    expect(result.playing).to.equal('mpris');

    // the desktop app opened the whole playlist: nothing for the daemon to continue
    expect(getMeta(db, shuffle.startedKey)).to.equal(null);

    const fits = fakeClient({ maxUris: 200 });
    await runShuffle(['rating:4'], { client: fits, readLibrary });
    const fitPlays = _.filter(fits.writes, ([, url]) => url.startsWith('/me/player/play'));
    expect(_.map(fitPlays, ([, , body]) => body.uris.length)).to.deep.equal([300, 150]);
    // 150 of 300 started: the notify daemon continues from the playlist at track 151
    expect(getMeta(db, shuffle.startedKey)).to.deep.include({
      playlistId: 'shuffleplaylist',
      count: 150,
      total: 300
    });
    expect(getMeta(db, shuffle.orderKey)).to.have.length(300);

    // every track of the next shuffle starts: nothing to continue
    await runShuffle(['liked'], { client: fakeClient() });
    expect(getMeta(db, shuffle.startedKey)).to.equal(null);
  });

  it('should open the playlist in the desktop app when the Web API cannot play it', async () => {
    const client = fakeClient({ failPlayer: true });
    const player = fakePlayer();
    const result = await runShuffle(['liked'], { client, player });
    expect(result).to.include({ written: true, playing: 'mpris' });
    expect(player.calls).to.deep.equal([
      ['shuffle', 'off'],
      ['open', 'spotify:playlist:shuffleplaylist'],
      ['shuffle', 'off']
    ]);
  });

  it('should keep the written playlist when Spotify cannot start it at all', async () => {
    const client = fakeClient({ failPlayer: true });
    const result = await runShuffle(['liked'], {
      client,
      player: fakePlayer(undefined, { fail: 'open' })
    });
    expect(result).to.include({ written: true, playing: false });
    expect(uris(client.writes)).to.have.length(5);
  });

  it('should tell library filters from Spotify sources', () => {
    expect(shuffle.isFilterTerms(['rating:4.5', '~mood:Sad'], config)).to.equal(true);
    expect(shuffle.isFilterTerms(['4.5'], config)).to.equal(true);
    expect(shuffle.isFilterTerms(["Nick's", 'Picks'], config)).to.equal(false);
    expect(shuffle.isFilterTerms(['https://open.spotify.com/playlist/x'], config)).to.equal(false);
    expect(shuffle.isFilterTerms([], config)).to.equal(false);
    expect(shuffle.isFilterTerms(['spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'], config)).to.equal(
      false
    );
    expect(shuffle.isFilterTerms(['unknown:x'], config)).to.equal(false);
  });
});

describe('Spotify Command', () => {
  it('should report shuffle and repeat without arguments', async () => {
    const player = fakePlayer();
    expect(await spotify.run({ options: { terms: [] }, player })).to.deep.equal({
      shuffle: true,
      repeat: 'off'
    });
    expect(player.calls).to.be.empty;
  });

  it('should set shuffle and repeat, and step repeat with next', async () => {
    const player = fakePlayer();
    const result = await spotify.run({
      options: { terms: ['shuffle', 'off', 'repeat', 'next'] },
      player
    });
    expect(player.calls).to.deep.equal([
      ['shuffle', 'off'],
      ['repeat', 'playlist']
    ]);
    expect(result).to.deep.equal({ shuffle: false, repeat: 'playlist' });
  });

  it('should refuse unknown settings and modes before changing anything', () => {
    expect(() => spotify.parseSettings(['shuffle', 'smart'])).to.throw(
      "shuffle takes on, off, toggle, not 'smart'"
    );
    expect(() => spotify.parseSettings(['volume', 'up'])).to.throw("Unknown setting 'volume'");
    expect(() => spotify.parseSettings(['repeat'])).to.throw('repeat takes');
  });

  it('should fail when Spotify is not running', async () => {
    const player = fakePlayer({ state: null, error: 'No players found' });
    await spotify.run({ options: { terms: ['shuffle', 'on'] }, player }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.equal('Spotify is not running (No players found)')
    );
    expect(player.calls).to.be.empty;
  });

  it('should report errors as one line with exit code 1 when run from the command line', async () => {
    const exitCode = process.exitCode;
    const result = await spotify.func({ options: { terms: ['bogus'] }, player: fakePlayer() });
    expect(result.error).to.include("Unknown setting 'bogus'");
    expect(process.exitCode).to.equal(1);
    process.exitCode = exitCode;
  });
});
