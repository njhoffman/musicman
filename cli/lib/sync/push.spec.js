const { expect } = require('chai');
const { pushPlan } = require('./push.js');

describe('Sync Push', () => {
  const recordingClient = ({ missingItems = false } = {}) => {
    const requests = [];
    return {
      requests,
      request: async (method, url, body) => {
        if (missingItems && url.endsWith('/items')) {
          const err = new Error('not found');
          err.status = 404;
          throw err;
        }
        requests.push([method, url, body]);
        return null;
      }
    };
  };
  const ids = (prefix, count) => Array.from({ length: count }, (value, i) => `${prefix}${i}`);
  const target = (id, add = [], prune = []) => ({
    id,
    name: id,
    add: add.map(trackId => ({ trackId })),
    prune: prune.map(trackId => ({ track_id: trackId }))
  });

  it('should save Liked Songs in batches of 50 and add to playlists in batches of 100', async () => {
    const client = recordingClient();
    const results = await pushPlan(client, [
      target('liked', ids('l', 60)),
      target('playlist1', ids('p', 120))
    ]);
    expect(
      client.requests.map(([method, url, body]) => [method, url, (body.ids || body.uris).length])
    ).to.deep.equal([
      ['PUT', '/me/tracks', 50],
      ['PUT', '/me/tracks', 10],
      ['POST', '/playlists/playlist1/items', 100],
      ['POST', '/playlists/playlist1/items', 20]
    ]);
    expect(client.requests[2][2].uris[0]).to.equal('spotify:track:p0');
    expect(results).to.deep.equal([
      { id: 'liked', name: 'liked', added: 60, removed: 0 },
      { id: 'playlist1', name: 'playlist1', added: 120, removed: 0 }
    ]);
  });

  it('should only remove tracks with prune', async () => {
    const plan = [target('liked', [], ['old']), target('playlist1', [], ['gone'])];
    const without = recordingClient();
    await pushPlan(without, plan);
    expect(without.requests).to.be.empty;

    const client = recordingClient();
    await pushPlan(client, plan, { prune: true });
    expect(client.requests).to.deep.equal([
      ['DELETE', '/me/tracks', { ids: ['old'] }],
      ['DELETE', '/playlists/playlist1/items', { items: [{ uri: 'spotify:track:gone' }] }]
    ]);
  });

  it('should fall back to the tracks endpoint when items is not found', async () => {
    const client = recordingClient({ missingItems: true });
    await pushPlan(client, [target('playlist1', ['a'], ['b'])], { prune: true });
    expect(client.requests).to.deep.equal([
      ['POST', '/playlists/playlist1/tracks', { uris: ['spotify:track:a'] }],
      ['DELETE', '/playlists/playlist1/tracks', { tracks: [{ uri: 'spotify:track:b' }] }]
    ]);
  });

  it('should not add duplicate track ids', async () => {
    const client = recordingClient();
    await pushPlan(client, [target('liked', ['a', 'a', 'b'])]);
    expect(client.requests[0][2]).to.deep.equal({ ids: ['a', 'b'] });
  });
});
