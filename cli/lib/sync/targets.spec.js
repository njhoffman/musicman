const { expect } = require('chai');
const { songTargets } = require('./targets.js');

describe('Sync Targets', () => {
  const config = scope => ({
    library: { tags: [{ name: 'context', id: 'TXXX.Context', multi: true }] },
    sync: {
      likedRating: 4.5,
      scope,
      playlists: [{ filter: 'context:Study', playlist: '6hik9wlDckKrPZ9FTusxJH' }]
    }
  });
  const songs = [
    ['/m/high.mp3', { rating: '5.0', context: 'Study' }],
    ['/m/low.mp3', { rating: '3.0', context: 'Study' }],
    ['/m/none.mp3', { context: 'Study' }]
  ];
  const targets = scope =>
    songTargets(songs, config(scope)).map(({ file, targets: ids, outOfScope }) => [
      file,
      ids,
      Boolean(outOfScope)
    ]);

  it('should put every song in its targets without a scope', () => {
    expect(targets(undefined)).to.deep.equal([
      ['/m/high.mp3', ['liked', '6hik9wlDckKrPZ9FTusxJH'], false],
      ['/m/low.mp3', ['6hik9wlDckKrPZ9FTusxJH'], false],
      ['/m/none.mp3', ['6hik9wlDckKrPZ9FTusxJH'], false]
    ]);
  });

  it('should leave songs outside sync.scope out of every target', () => {
    expect(targets('rating:4.5')).to.deep.equal([
      ['/m/high.mp3', ['liked', '6hik9wlDckKrPZ9FTusxJH'], false],
      ['/m/low.mp3', [], true],
      ['/m/none.mp3', [], true]
    ]);
  });
});
