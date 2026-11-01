const { expect } = require('chai');

const { withShuffleSource } = require('./context.js');

describe('Spotify Context', () => {
  describe('withShuffleSource', () => {
    const shuffled = {
      source: { terms: ['liked'], name: 'Liked Songs' },
      playlistId: 'shuffle1',
      order: ['t1', 't2']
    };
    const playlist = id => ({ type: 'playlist', name: 'Mix', uri: `spotify:playlist:${id}` });
    const contextOf = (context, readShuffle = () => shuffled) =>
      withShuffleSource(async () => context, readShuffle);

    it('should name the shuffle source for a list without a context holding the track', async () => {
      expect(await contextOf(null)({ trackId: 't2' })).to.deep.equal({
        type: 'shuffle',
        name: 'Liked Songs',
        uri: null
      });
    });

    it('should leave a list without a context alone when the track is not in the shuffle', async () => {
      expect(await contextOf(null)({ trackId: 'other' })).to.equal(null);
      expect(await contextOf(null)({})).to.equal(null);
    });

    it('should name the shuffle source when the shuffle playlist itself plays', async () => {
      expect(await contextOf(playlist('shuffle1'))({ trackId: 'any' })).to.deep.equal({
        type: 'shuffle',
        name: 'Liked Songs',
        uri: 'spotify:playlist:shuffle1'
      });
    });

    it('should keep other contexts, and every context without a known shuffle', async () => {
      expect(await contextOf(playlist('other'))({ trackId: 't1' })).to.deep.equal(
        playlist('other')
      );
      expect(await contextOf(null, () => ({}))({ trackId: 't1' })).to.equal(null);
      expect(await contextOf(null, () => null)({ trackId: 't1' })).to.equal(null);
    });

    it('should still find the shuffle when the Spotify context cannot be read', async () => {
      const failing = withShuffleSource(
        async () => {
          throw new Error('not logged in');
        },
        () => shuffled
      );
      expect((await failing({ trackId: 't1' })).type).to.equal('shuffle');
    });
  });
});
