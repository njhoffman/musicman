const { expect } = require('chai');
const { filterTag, membershipChanges } = require('./membership.js');

describe('Spotify Membership Changes', () => {
  const config = {
    library: {
      tags: [
        { name: 'context', id: 'TXXX.Context', multi: true },
        { name: 'picks', id: 'TXXX.Picks', multi: true },
        { name: 'grouping', id: 'TIT1' }
      ]
    },
    sync: {
      playlists: [
        { filter: 'context:Study', playlist: '6hik9wlDckKrPZ9FTusxJH' },
        { filter: 'picks:Hot', playlist: '0n9JG8Dm0RUQZohcEsfVfu' },
        { filter: 'grouping:IndieRock.Artists', playlist: '25khvbDJw6mVwq4sxA6Tje' }
      ]
    }
  };

  it('should invert only filters on one value of a multi value field', () => {
    expect(filterTag('context:Study', config)).to.deep.equal({ field: 'context', value: 'Study' });
    expect(filterTag('grouping:IndieRock.Artists', config)).to.be.null;
    expect(filterTag('context:Study,Run', config)).to.be.null;
    expect(filterTag('context:Study picks:Hot', config)).to.be.null;
    expect(filterTag('context:Study ~picks:Hot', config)).to.be.null;
    expect(filterTag('context:Study rating:4', config)).to.be.null;
  });

  it('should add and remove filter values, and list the changes that need a decision', () => {
    const plan = [
      {
        id: '6hik9wlDckKrPZ9FTusxJH',
        name: 'Study',
        spotifyAdded: [{ file: '/m/a.mp3', name: 'A', artists: 'X' }],
        spotifyRemoved: [{ file: '/m/b.mp3' }]
      },
      {
        id: '0n9JG8Dm0RUQZohcEsfVfu',
        name: 'Hot',
        spotifyAdded: [{ file: '/m/a.mp3', name: 'A', artists: 'X' }],
        spotifyRemoved: []
      },
      {
        id: '25khvbDJw6mVwq4sxA6Tje',
        name: 'Indie',
        spotifyAdded: [{ file: '/m/c.mp3', name: 'C', artists: 'Z' }],
        spotifyRemoved: []
      },
      { id: 'liked', name: 'Liked Songs', spotifyAdded: [], spotifyRemoved: [{ file: '/m/d.mp3' }] }
    ];
    const { assignments, decide } = membershipChanges(plan, config);
    expect(assignments).to.deep.equal({
      '/m/a.mp3': { context: ['+Study'], picks: ['+Hot'] },
      '/m/b.mp3': { context: ['-Study'] }
    });
    expect(decide.map(({ file, target, change }) => [file, target, change])).to.deep.equal([
      ['/m/c.mp3', 'Indie', 'added'],
      ['/m/d.mp3', 'Liked Songs', 'removed']
    ]);
  });

  it('should tag every copy of a song and ask once per track', () => {
    const track = { file: '/m/a.mp3', files: ['/m/a.mp3', '/m/a.1.mp3'], name: 'A', artists: 'X' };
    const plan = [
      { id: '0n9JG8Dm0RUQZohcEsfVfu', name: 'Hot', spotifyAdded: [track], spotifyRemoved: [] },
      { id: 'liked', name: 'Liked Songs', spotifyAdded: [track], spotifyRemoved: [] }
    ];
    const { assignments, decide } = membershipChanges(plan, config);
    expect(assignments).to.deep.equal({
      '/m/a.mp3': { picks: ['+Hot'] },
      '/m/a.1.mp3': { picks: ['+Hot'] }
    });
    expect(decide.map(({ file, target }) => [file, target])).to.deep.equal([
      ['/m/a.mp3', 'Liked Songs']
    ]);
  });
});
