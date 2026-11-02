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

  describe('conflictingTargets', () => {
    const { conflictingTargets } = require('./targets.js');
    const groups = [
      { field: 'rating', targets: [{ id: 'r4' }, { id: 'r5' }] },
      { field: 'grouping', targets: [{ id: 'indie' }, { id: 'folk' }, { id: 'indie' }] }
    ];

    it('should list the group playlists copies disagree on, per group', () => {
      expect([
        ...conflictingTargets(groups, [
          ['r4', 'indie', 'study'],
          ['r5', 'indie']
        ])
      ]).to.deep.equal(['r4', 'r5']);
      expect([
        ...conflictingTargets(groups, [
          ['r4', 'indie'],
          ['r5', 'folk']
        ])
      ]).to.have.members(['r4', 'r5', 'indie', 'folk']);
    });

    it('should be empty when the copies agree, there is one copy, or a copy belongs in none', () => {
      expect(conflictingTargets(groups, [['r5', 'study'], ['r5']]).size).to.equal(0);
      expect(conflictingTargets(groups, [['r4']]).size).to.equal(0);
      expect(conflictingTargets(groups, [['r4'], []]).size).to.equal(0);
      expect(conflictingTargets([], [['r4'], ['r5']]).size).to.equal(0);
    });
  });
});
