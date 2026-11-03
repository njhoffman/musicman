const { expect } = require('chai');

const { parseSettings, run } = require('./spotify.js');

describe('Spotify command', () => {
  const output = () => {
    const written = [];
    return { written, out: { write: text => written.push(text) } };
  };
  const client = () => ({
    get: async () => ({
      currently_playing: { type: 'track', id: 'a', name: 'Now', artists: [{ name: 'A' }] },
      queue: [{ type: 'track', id: 'b', name: 'Next', artists: [{ name: 'B' }] }]
    })
  });

  it('should print the queue as JSON with queue --format json, asking no player', async () => {
    const { written, out } = output();
    const player = {
      state: async () => {
        throw new Error('not asked');
      }
    };
    const queue = await run({
      options: { terms: ['queue'], switches: { format: 'json' } },
      player,
      client,
      out
    });
    expect(queue.queue.map(track => track.id)).to.deep.equal(['b']);
    expect(JSON.parse(written.join(''))).to.deep.equal(queue);
  });

  it('should refuse other formats and more words after queue', async () => {
    const { out } = output();
    const fails = async options => {
      try {
        await run({ options, client, out });
      } catch (err) {
        return err.message;
      }
      return null;
    };
    expect(await fails({ terms: ['queue'], switches: { format: 'csv' } })).to.match(/not csv/);
    expect(await fails({ terms: ['queue', 'now'] })).to.match(/takes no more words/);
  });

  it('should still parse shuffle and repeat settings', () => {
    expect(parseSettings(['shuffle', 'on'])).to.deep.equal([{ setting: 'shuffle', mode: 'on' }]);
    expect(() => parseSettings(['queue'])).to.throw(/Unknown setting/);
  });
});
