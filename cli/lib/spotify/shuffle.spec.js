const { expect } = require('chai');
const _ = require('lodash');

const {
  ensurePlaylist,
  findPlaylist,
  playlistIdOf,
  replaceTracks,
  rowTracks,
  shuffleOrder,
  spotifySourceTracks
} = require('./shuffle.js');

const playlistId = '37i9dQZF1DXcBWIGoYBM5M';

// a Spotify client answering GETs and paginated lists from routes (by path prefix), recording requests
const fakeClient = (routes, { failOn = {} } = {}) => {
  const requests = [];
  const answer = url => {
    const route = _.find(_.keys(routes), prefix => url.startsWith(prefix));
    if (!route) {
      throw new Error(`no route for ${url}`);
    }
    return _.cloneDeep(routes[route]);
  };
  return {
    requests,
    get: async url => answer(url),
    paginate: async url => answer(url),
    request: async (method, url, body) => {
      requests.push([method, url, body]);
      const status = failOn[`${method} ${url.replace(/\?.*/, '')}`];
      if (status) {
        throw Object.assign(new Error(`failed (${status})`), { status });
      }
      return method === 'POST' && /playlists$/.test(url) ? { id: 'newplaylist' } : {};
    }
  };
};

const item = (id, extra = {}) => ({ added_at: '2026-01-01', item: { id, name: id }, ...extra });

describe('Spotify shuffle', () => {
  describe('shuffleOrder', () => {
    it('should return every item once without changing the input', () => {
      const items = _.range(50);
      const order = shuffleOrder(items);
      expect(_.sortBy(order)).to.deep.equal(items);
      expect(items).to.deep.equal(_.range(50));
    });

    it('should follow the random source (Fisher-Yates)', () => {
      // random 0 swaps each position, last first, with the first: [a b c d] -> b c d a
      expect(shuffleOrder(['a', 'b', 'c', 'd'], () => 0)).to.deep.equal(['b', 'c', 'd', 'a']);
      // just under 1 leaves every item in place
      expect(shuffleOrder(['a', 'b', 'c'], () => 0.999)).to.deep.equal(['a', 'b', 'c']);
    });

    it('should give every order about as often (uniform)', () => {
      let seed = 7;
      // a small deterministic generator, so the test never flakes
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const counts = _.countBy(_.times(6000, () => shuffleOrder(['a', 'b', 'c'], random).join('')));
      expect(_.keys(counts)).to.have.length(6);
      _.values(counts).forEach(count => expect(count).to.be.within(850, 1150));
    });
  });

  it('should leave out local files and tracks without an id, and duplicates', () => {
    expect(
      rowTracks([
        { track_id: 'a', is_local: 0 },
        { track_id: null, is_local: 1 },
        { track_id: 'b', is_local: 0 },
        { track_id: 'a', is_local: 0 },
        { track_id: null, is_local: 0 }
      ])
    ).to.deep.equal({ trackIds: ['a', 'b'], skipped: 2, total: 5 });
  });

  it('should read playlist ids from URLs, URIs, and bare ids only', () => {
    expect(playlistIdOf(`https://open.spotify.com/playlist/${playlistId}?si=abc`)).to.equal(
      playlistId
    );
    expect(playlistIdOf(`spotify:playlist:${playlistId}`)).to.equal(playlistId);
    expect(playlistIdOf(playlistId)).to.equal(playlistId);
    expect(playlistIdOf("Nick's Picks")).to.equal(null);
  });

  it('should find a playlist by name without case, and refuse missing or ambiguous names', () => {
    const playlists = [
      { id: '1', name: 'Study' },
      { id: '2', name: 'Hot' },
      { id: '3', name: 'hot' }
    ];
    expect(findPlaylist(playlists, 'study').id).to.equal('1');
    expect(() => findPlaylist(playlists, 'Chill')).to.throw("No playlist named 'Chill'");
    expect(() => findPlaylist(playlists, 'Hot')).to.throw("2 playlists are named 'Hot'");
  });

  describe('spotifySourceTracks', () => {
    it('should read Liked Songs for liked', async () => {
      const client = fakeClient({
        '/me/tracks': [{ added_at: '2026-01-01', track: { id: 'a' } }, { track: { id: 'b' } }]
      });
      expect(await spotifySourceTracks(client, 'Liked')).to.deep.equal({
        name: 'Liked Songs',
        trackIds: ['a', 'b'],
        skipped: 0,
        total: 2
      });
    });

    it('should read a playlist by URL or by the name of one of yours', async () => {
      const routes = {
        [`/playlists/${playlistId}?`]: { name: 'Study' },
        [`/playlists/${playlistId}/items`]: [item('a'), item(null, { is_local: true }), item('b')],
        '/me/playlists': [{ id: playlistId, name: 'Study', owner: { id: 'me' } }]
      };
      const byUrl = await spotifySourceTracks(
        fakeClient(routes),
        `https://open.spotify.com/playlist/${playlistId}`
      );
      expect(byUrl).to.deep.equal({
        name: 'Study',
        playlistId,
        trackIds: ['a', 'b'],
        skipped: 1,
        total: 3
      });
      expect((await spotifySourceTracks(fakeClient(routes), 'study')).trackIds).to.deep.equal([
        'a',
        'b'
      ]);
    });
  });

  describe('ensurePlaylist', () => {
    const owned = [
      { id: 'theirs', name: 'musicman shuffle', owner: { id: 'someone' } },
      { id: 'mine1', name: 'musicman shuffle', owner: { id: 'me' } },
      { id: 'mine2', name: 'Musicman Shuffle', owner: { id: 'me' } }
    ];

    it('should use your own playlist of that name, the known one when there are several', async () => {
      const routes = { '/me/playlists': owned, '/me': { id: 'me' } };
      expect(await ensurePlaylist(fakeClient(routes), { name: 'musicman shuffle' })).to.deep.equal({
        id: 'mine1',
        created: false
      });
      expect(
        await ensurePlaylist(fakeClient(routes), { name: 'musicman shuffle', knownId: 'mine2' })
      ).to.deep.equal({ id: 'mine2', created: false });
    });

    it('should create a private playlist when you have none, not use one you only follow', async () => {
      const client = fakeClient({ '/me/playlists': [owned[0]], '/me': { id: 'me' } });
      expect(
        await ensurePlaylist(client, { name: 'musicman shuffle', description: 'random' })
      ).to.deep.equal({ id: 'newplaylist', created: true });
      expect(client.requests).to.deep.equal([
        [
          'POST',
          '/me/playlists',
          { name: 'musicman shuffle', public: false, description: 'random' }
        ]
      ]);
    });

    it('should create it under /users/{id} where /me/playlists cannot', async () => {
      const client = fakeClient(
        { '/me/playlists': [], '/me': { id: 'me' } },
        { failOn: { 'POST /me/playlists': 404 } }
      );
      expect((await ensurePlaylist(client, { name: 'x' })).created).to.equal(true);
      expect(_.map(client.requests, 1)).to.deep.equal(['/me/playlists', '/users/me/playlists']);
    });
  });

  describe('replaceTracks', () => {
    it('should replace with the first 100 tracks and append the rest in order', async () => {
      const client = fakeClient({});
      const progress = [];
      const ids = _.map(_.range(250), i => `t${i}`);
      await replaceTracks(client, 'p', ids, { onProgress: ({ done }) => progress.push(done) });
      expect(
        _.map(client.requests, ([method, url, body]) => [method, url, body.uris.length])
      ).to.deep.equal([
        ['PUT', '/playlists/p/items', 100],
        ['POST', '/playlists/p/items', 100],
        ['POST', '/playlists/p/items', 50]
      ]);
      expect(_.flatMap(client.requests, ([, , body]) => body.uris)).to.deep.equal(
        _.map(ids, id => `spotify:track:${id}`)
      );
      expect(progress).to.deep.equal([100, 200, 250]);
    });

    it('should empty the playlist for no tracks, and fall back to /tracks', async () => {
      const client = fakeClient({}, { failOn: { 'PUT /playlists/p/items': 404 } });
      await replaceTracks(client, 'p', []);
      expect(client.requests).to.deep.equal([
        ['PUT', '/playlists/p/items', { uris: [] }],
        ['PUT', '/playlists/p/tracks', { uris: [] }]
      ]);
    });
  });
});
