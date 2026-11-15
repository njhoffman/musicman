const { expect } = require('chai');

const { getMeta, openDatabase, setMeta } = require('../db/database.js');
const { orderKey, playlistIdKey, startedKey } = require('../commands/shuffle.js');
const {
  backKey,
  captureBack,
  captureSpotify,
  commitBack,
  goBack,
  onSideTrip,
  restoreSpotify
} = require('./back.js');

// a Spotify client answering GET from replies (by path), recording every request; requests whose
// body matches refuse (an Error with that status) answer like the Web API refusing them
const fakeClient = (replies = {}, { refuse = () => null } = {}) => {
  const requests = [];
  return {
    requests,
    get: async url => replies[url] || null,
    request: async (method, url, body) => {
      requests.push([method, url, body]);
      const status = refuse(method, url, body);
      if (status) {
        const err = new Error(`refused ${status}`);
        err.status = status;
        throw err;
      }
      return null;
    }
  };
};

const devices = { devices: [{ id: 'dev1', name: 'charon', is_active: true }] };

describe('Player back', () => {
  let db;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });
  afterEach(() => db.close());

  const mpdPlayer = snapshot => ({ source: 'mpd', snapshot: async () => snapshot });
  const mpdStatus = file => ({
    state: 'playing',
    track: { file, title: 'Main', artist: 'Band' }
  });
  const snapshot = {
    files: ['a.mp3', 'b.mp3'],
    position: 1,
    elapsed: 42.5,
    modes: { random: '0', repeat: '1', single: '0', consume: '0' }
  };

  describe('captureBack and commitBack', () => {
    it('should remember the MPD queue before a side trip and the songs the side trip plays', async () => {
      const captured = await captureBack({
        db,
        player: mpdPlayer(snapshot),
        status: mpdStatus('/music/b.mp3')
      });
      const stored = commitBack(db, captured, { source: 'mpd', ids: ['/music/x.mp3'] });
      expect(stored).to.include({ source: 'mpd' });
      expect(stored.mpd).to.deep.equal(snapshot);
      expect(stored.track).to.deep.equal({ title: 'Main', artist: 'Band' });
      expect(getMeta(db, backKey).side).to.deep.equal({ source: 'mpd', ids: ['/music/x.mp3'] });
    });

    it('should keep the point while the side trip plays, adding the next side trip to it', async () => {
      const first = await captureBack({
        db,
        player: mpdPlayer(snapshot),
        status: mpdStatus('/music/b.mp3')
      });
      commitBack(db, first, { source: 'mpd', ids: ['/music/x.mp3'] });
      const second = await captureBack({
        db,
        player: mpdPlayer({ files: ['x.mp3'], position: 0, elapsed: 3, modes: {} }),
        status: mpdStatus('/music/x.mp3')
      });
      expect(second).to.deep.equal({ keep: true });
      const stored = commitBack(db, second, { source: 'mpd', ids: ['/music/y.mp3'] });
      expect(stored.mpd).to.deep.equal(snapshot);
      expect(stored.side.ids).to.deep.equal(['/music/x.mp3', '/music/y.mp3']);
    });

    it('should replace the point once something else than the side trip plays', async () => {
      setMeta(db, backKey, {
        source: 'mpd',
        mpd: { files: ['old.mp3'] },
        side: { source: 'mpd', ids: ['/music/x.mp3'] }
      });
      const captured = await captureBack({
        db,
        player: mpdPlayer(snapshot),
        status: mpdStatus('/music/b.mp3')
      });
      expect(captured.point.mpd).to.deep.equal(snapshot);
    });

    it('should remember nothing new when the player plays nothing, keeping a saved point', async () => {
      expect(
        await captureBack({
          db,
          player: mpdPlayer(snapshot),
          status: { state: 'stopped', track: null }
        })
      ).to.deep.equal({ keep: true });
      expect(commitBack(db, { keep: true }, { source: 'mpd', ids: ['/music/x.mp3'] })).to.equal(
        null
      );
      expect(getMeta(db, backKey)).to.equal(null);
    });

    it('should tell the side trip by the track id on Spotify', () => {
      const point = { side: { source: 'spotify', ids: ['t1'] } };
      const player = { source: 'spotify' };
      expect(onSideTrip(point, player, { track: { trackId: 't1' } })).to.equal(true);
      expect(onSideTrip(point, player, { track: { trackId: 't2' } })).to.equal(false);
      expect(onSideTrip(point, { source: 'mpd' }, { track: { file: 't1' } })).to.equal(false);
      expect(onSideTrip(null, player, { track: { trackId: 't1' } })).to.equal(false);
    });

    it('should remember what Spotify plays through the Web API', async () => {
      const client = fakeClient({
        '/me/player': {
          item: { id: 't9', uri: 'spotify:track:t9' },
          context: { uri: 'spotify:playlist:main' },
          progress_ms: 61000,
          shuffle_state: false,
          repeat_state: 'context'
        }
      });
      const captured = await captureBack({
        db,
        player: { source: 'spotify' },
        status: { state: 'paused', track: { trackId: 't9', title: 'T', artist: 'A' } },
        client: () => client
      });
      expect(captured.point).to.include({ source: 'spotify' });
      expect(captured.point.spotify).to.deep.equal({
        trackUri: 'spotify:track:t9',
        progressMs: 61000,
        shuffle: false,
        repeat: 'context',
        contextUri: 'spotify:playlist:main'
      });
    });
  });

  describe('captureSpotify', () => {
    it('should place a musicman shuffle list in the shuffle playlist by the track', async () => {
      const client = fakeClient({
        '/me/player': { item: { id: 'c', uri: 'spotify:track:c' }, context: null, progress_ms: 5 }
      });
      expect(
        await captureSpotify(client, { order: ['a', 'b', 'c'], playlistId: 'sp' })
      ).to.deep.equal({
        trackUri: 'spotify:track:c',
        progressMs: 5,
        shuffle: null,
        repeat: null,
        contextUri: 'spotify:playlist:sp',
        offset: 2,
        shuffleList: true
      });
    });

    it('should keep the track and the queue of another list without a context', async () => {
      const client = fakeClient({
        '/me/player': { item: { id: 'x', uri: 'spotify:track:x' }, progress_ms: 0 },
        '/me/player/queue': { queue: [{ uri: 'spotify:track:y' }, { uri: 'spotify:track:x' }] }
      });
      const point = await captureSpotify(client, { order: ['a'], playlistId: 'sp' });
      expect(point.uris).to.deep.equal(['spotify:track:x', 'spotify:track:y']);
      expect(point).to.not.have.property('contextUri');
    });

    it('should be null when Spotify plays nothing', async () => {
      expect(await captureSpotify(fakeClient())).to.equal(null);
    });
  });

  describe('restoreSpotify', () => {
    it('should play the context at the track and progress, then shuffle and repeat as they were', async () => {
      const client = fakeClient({ '/me/player/devices': devices });
      const device = await restoreSpotify(client, {
        contextUri: 'spotify:playlist:main',
        trackUri: 'spotify:track:t9',
        progressMs: 61000,
        shuffle: true,
        repeat: 'context'
      });
      expect(device).to.equal('charon');
      expect(client.requests).to.deep.equal([
        ['PUT', '/me/player/shuffle?state=false&device_id=dev1', undefined],
        [
          'PUT',
          '/me/player/play?device_id=dev1',
          {
            context_uri: 'spotify:playlist:main',
            offset: { uri: 'spotify:track:t9' },
            position_ms: 61000
          }
        ],
        ['PUT', '/me/player/shuffle?state=true&device_id=dev1', undefined],
        ['PUT', '/me/player/repeat?state=context&device_id=dev1', undefined]
      ]);
    });

    it('should play the shuffle playlist by place, and a list from its first track', async () => {
      const client = fakeClient({ '/me/player/devices': devices });
      await restoreSpotify(client, {
        contextUri: 'spotify:playlist:sp',
        offset: 2,
        trackUri: 'spotify:track:c',
        progressMs: 5
      });
      await restoreSpotify(client, { uris: ['spotify:track:x'], progressMs: 7 });
      const plays = client.requests.filter(([, url]) => url.startsWith('/me/player/play'));
      expect(plays.map(([, , body]) => body)).to.deep.equal([
        { context_uri: 'spotify:playlist:sp', offset: { position: 2 }, position_ms: 5 },
        { uris: ['spotify:track:x'], offset: { position: 0 }, position_ms: 7 }
      ]);
    });

    it('should start the context from its beginning when Spotify refuses the track', async () => {
      const client = fakeClient(
        { '/me/player/devices': devices },
        { refuse: (method, url, body) => (body && body.offset ? 400 : null) }
      );
      await restoreSpotify(client, {
        contextUri: 'spotify:album:al',
        trackUri: 'spotify:local:x',
        progressMs: 0
      });
      const plays = client.requests.filter(([, url]) => url.startsWith('/me/player/play'));
      expect(plays[1][2]).to.deep.equal({ context_uri: 'spotify:album:al' });
    });

    it('should fail without a device', async () => {
      await restoreSpotify(fakeClient(), { uris: [] }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('no Spotify Connect device is available')
      );
    });
  });

  describe('goBack', () => {
    it('should restore the MPD queue and clear the point', async () => {
      setMeta(db, backKey, { source: 'mpd', track: { title: 'Main' }, mpd: snapshot });
      const restored = [];
      const mpd = {
        restore: async point => {
          restored.push(point);
          return { count: 2, skipped: 0, position: 1 };
        }
      };
      const result = await goBack({ db, mpd });
      expect(restored).to.deep.equal([snapshot]);
      expect(result).to.deep.equal({
        source: 'mpd',
        track: { title: 'Main' },
        count: 2,
        skipped: 0,
        position: 1
      });
      expect(getMeta(db, backKey)).to.equal(null);
    });

    it('should restore Spotify, ending a pending shuffle handoff for the shuffle playlist', async () => {
      setMeta(db, startedKey, { playlistId: 'sp', count: 1, total: 3 });
      setMeta(db, orderKey, ['a', 'b', 'c']);
      setMeta(db, playlistIdKey, 'sp');
      setMeta(db, backKey, {
        source: 'spotify',
        track: { title: 'C' },
        spotify: { contextUri: 'spotify:playlist:sp', offset: 2, shuffleList: true, progressMs: 0 }
      });
      const client = fakeClient({ '/me/player/devices': devices });
      const result = await goBack({ db, client: () => client });
      expect(result).to.deep.equal({ source: 'spotify', track: { title: 'C' }, device: 'charon' });
      expect(getMeta(db, startedKey)).to.equal(null);
      expect(getMeta(db, backKey)).to.equal(null);
    });

    it('should keep the point when the restore fails, and fail without one', async () => {
      setMeta(db, backKey, { source: 'mpd', track: {}, mpd: snapshot });
      const mpd = {
        restore: async () => {
          throw new Error('MPD went away');
        }
      };
      await goBack({ db, mpd }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('MPD went away')
      );
      expect(getMeta(db, backKey)).to.not.equal(null);
      setMeta(db, backKey, null);
      await goBack({ db, mpd }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.match(/^Nothing to go back to/)
      );
    });
  });
});
