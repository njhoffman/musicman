const { expect } = require('chai');

const { reshuffleSource } = require('./menu.js');

describe('Menu reshuffle source', () => {
  const track = { trackId: 't1' };
  const lastSource = { terms: ['rating:4.5'], name: 'rating:4.5' };
  const pick = (context, extra = {}) =>
    reshuffleSource({
      track,
      contextOf: async () => context,
      lastSource,
      shufflePlaylistId: 'shuffleid',
      ...extra
    });

  it('should shuffle the playlist that is playing', async () => {
    expect(
      await pick({ type: 'playlist', name: 'Study', uri: 'spotify:playlist:study1' })
    ).to.deep.equal({ name: 'Study', terms: ['spotify:playlist:study1'] });
  });

  it('should shuffle Liked Songs when they are playing', async () => {
    expect(
      await pick({ type: 'collection', name: 'Liked Songs', uri: 'spotify:user:me:collection' })
    ).to.deep.equal({ name: 'Liked Songs', terms: ['liked'] });
  });

  it('should fall back to the last source for the shuffle playlist, albums, track lists, and errors', async () => {
    const fallback = { name: 'rating:4.5', terms: ['rating:4.5'] };
    expect(
      await pick({ type: 'playlist', name: 'musicman shuffle', uri: 'spotify:playlist:shuffleid' })
    ).to.deep.equal(fallback);
    expect(await pick({ type: 'album', name: 'X', uri: 'spotify:album:x' })).to.deep.equal(
      fallback
    );
    expect(await pick(null)).to.deep.equal(fallback);
    expect(
      await reshuffleSource({
        track,
        contextOf: async () => {
          throw new Error('offline');
        },
        lastSource,
        shufflePlaylistId: null
      })
    ).to.deep.equal(fallback);
  });

  it('should offer nothing without a context or a last source', async () => {
    expect(await pick(null, { lastSource: null })).to.equal(null);
  });
});
