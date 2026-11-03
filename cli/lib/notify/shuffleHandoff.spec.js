const { expect } = require('chai');

const { openDatabase, setMeta } = require('../db/database.js');
const { orderKey, startedKey } = require('../commands/shuffle.js');
const { shuffleHandoff } = require('./shuffleHandoff.js');

describe('shuffle handoff', () => {
  let db;
  let requests;
  let playing;
  const order = ['t0', 't1', 't2', 't3', 't4'];
  const spotify = { source: 'spotify', name: 'Spotify' };
  const at = trackId => ({ player: spotify, status: { track: { trackId, position: 1.5 } } });

  const fakeClient = () => ({
    get: async url => {
      requests.push(['GET', url]);
      return playing;
    },
    request: async (method, url, body) => {
      requests.push(body === undefined ? [method, url] : [method, url, body]);
      return null;
    }
  });
  const handoff = () =>
    shuffleHandoff({
      openDb: () => ({ ...db, close: () => {}, prepare: sql => db.prepare(sql) }),
      client: fakeClient
    });

  beforeEach(() => {
    db = openDatabase(':memory:');
    requests = [];
    playing = { progress_ms: 2300, context: null };
    setMeta(db, orderKey, order);
    setMeta(db, startedKey, {
      playlistId: 'pl1',
      count: 3,
      total: 5,
      startedAt: '2026-11-03T10:00:00.000Z'
    });
  });

  afterEach(() => db.close());

  it('should queue the next track when the last listed one starts, then move to the playlist there', async () => {
    const onTrack = handoff();
    expect(await onTrack(at('t1'))).to.equal(null);
    expect(await onTrack(at('t2'))).to.equal('queued');
    // a second event for the same track queues nothing more
    expect(await onTrack(at('t2'))).to.equal(null);
    expect(await onTrack(at('t3'))).to.equal('handed');
    expect(await onTrack(at('t3'))).to.equal(null);
    expect(requests).to.deep.equal([
      ['POST', '/me/player/queue?uri=spotify%3Atrack%3At3'],
      ['GET', '/me/player'],
      [
        'PUT',
        '/me/player/play',
        { context_uri: 'spotify:playlist:pl1', offset: { position: 3 }, position_ms: 2300 }
      ]
    ]);
  });

  it('should not move playback when the playlist plays already, as after a daemon restart', async () => {
    playing = { progress_ms: 100, context: { uri: 'spotify:playlist:pl1' } };
    expect(await handoff()(at('t3'))).to.equal(null);
    expect(requests).to.deep.equal([['GET', '/me/player']]);
  });

  it('should do nothing when every track was started, for other players, or for other tracks', async () => {
    const onTrack = handoff();
    expect(
      await onTrack({ player: { source: 'mpd' }, status: { track: { file: 'a.mp3' } } })
    ).to.equal(null);
    expect(await onTrack(at('elsewhere'))).to.equal(null);
    setMeta(db, startedKey, null);
    expect(await onTrack(at('t2'))).to.equal(null);
    expect(await shuffleHandoff({ openDb: () => null, client: fakeClient })(at('t2'))).to.equal(
      null
    );
    expect(requests).to.deep.equal([]);
  });

  it('should take each step once per shuffle, again for a new shuffle', async () => {
    const onTrack = handoff();
    await onTrack(at('t2'));
    setMeta(db, startedKey, {
      playlistId: 'pl1',
      count: 3,
      total: 5,
      startedAt: '2026-11-03T11:00:00.000Z'
    });
    expect(await onTrack(at('t2'))).to.equal('queued');
  });
});
