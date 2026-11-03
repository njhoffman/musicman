const { expect } = require('chai');

const { describeQueue, queueTrack, spotifyQueue } = require('./queue.js');

const track = (id, name, extra = {}) => ({
  type: 'track',
  id,
  name,
  artists: [{ name: 'Artist' }, { name: 'Guest' }],
  album: { name: 'Album' },
  duration_ms: 200000,
  external_ids: { isrc: `ISRC${id}` },
  ...extra
});

describe('Spotify queue', () => {
  const clientFor = answer => {
    const asked = [];
    return {
      asked,
      client: () => ({
        get: async url => {
          asked.push(url);
          return answer;
        }
      })
    };
  };

  it('should give the track playing and the next tracks in the contract shape', async () => {
    const { asked, client } = clientFor({
      currently_playing: track('a', 'Now'),
      queue: [track('b', 'Next'), { type: 'episode', id: 'e', name: 'Show' }, track('c', 'After')]
    });
    const queue = await spotifyQueue(client);
    expect(asked).to.deep.equal(['/me/player/queue']);
    expect(queue).to.deep.equal({
      version: 1,
      playing: {
        id: 'a',
        title: 'Now',
        artists: ['Artist', 'Guest'],
        album: 'Album',
        durationMs: 200000,
        isrc: 'ISRCa'
      },
      queue: [
        {
          id: 'b',
          title: 'Next',
          artists: ['Artist', 'Guest'],
          album: 'Album',
          durationMs: 200000,
          isrc: 'ISRCb'
        },
        {
          id: 'c',
          title: 'After',
          artists: ['Artist', 'Guest'],
          album: 'Album',
          durationMs: 200000,
          isrc: 'ISRCc'
        }
      ]
    });
  });

  it('should keep at most limit tracks, and say nothing plays when Spotify does not', async () => {
    const many = clientFor({
      currently_playing: null,
      queue: [1, 2, 3, 4, 5, 6, 7].map(n => track(`t${n}`, `T${n}`))
    });
    const queue = await spotifyQueue(many.client, { limit: 3 });
    expect(queue.playing).to.equal(null);
    expect(queue.queue.map(item => item.id)).to.deep.equal(['t1', 't2', 't3']);
    expect(await spotifyQueue(clientFor(null).client)).to.deep.equal({
      version: 1,
      playing: null,
      queue: []
    });
  });

  it('should leave out fields the Web API does not give, and describe the queue as lines', () => {
    expect(queueTrack({ type: 'track', id: 'x', name: 'X', artists: [] })).to.deep.equal({
      id: 'x',
      title: 'X',
      artists: [],
      album: null,
      durationMs: null,
      isrc: null
    });
    expect(queueTrack({ type: 'track', name: 'Local' })).to.equal(null);
    expect(
      describeQueue({
        playing: queueTrack(track('a', 'Now')),
        queue: [queueTrack(track('b', 'Next'))]
      })
    ).to.deep.equal(['Playing: Artist, Guest - Now', '1. Artist, Guest - Next']);
    expect(describeQueue({ playing: null, queue: [] })).to.deep.equal(['Nothing queued']);
  });
});
