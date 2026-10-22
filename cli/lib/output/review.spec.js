const { expect } = require('chai');
const { stripAnsi } = require('../utils/logger.js');
const { reviewDifferences, reviewLines } = require('./review.js');

describe('Review Output', () => {
  const items = [
    {
      file: '/m/a.mp3',
      linked: true,
      song: { artist: 'The Doors', title: 'Yes, the River Knows', duration: 260 },
      candidate: {
        artists: 'The Doors',
        name: 'Yes, The River Knows - Rough Mix',
        album: 'Waiting for the Sun (50th)',
        durationMs: 278000
      }
    },
    {
      file: '/m/b.mp3',
      linked: false,
      song: { artist: 'Zero 7', title: 'In the Waiting Line (radio edit)', duration: 200 },
      candidate: {
        artists: 'Zero 7',
        name: 'In The Waiting Line',
        album: 'Simple Things',
        durationMs: 200000
      }
    }
  ];

  it('should give the duration difference and the title words only one side has', () => {
    expect(reviewDifferences(items[0])).to.equal('+18.0s +rough');
    expect(reviewDifferences(items[1])).to.equal('0.0s -radio');
  });

  it('should key aligned review columns by file for fzf', () => {
    const lines = reviewLines(items);
    const [first, second] = ['/m/a.mp3', '/m/b.mp3'].map(file => stripAnsi(lines.get(file)));
    expect(first.split('\t')[0]).to.equal('/m/a.mp3');
    expect(first.split('\t')[1]).to.equal(
      [
        'linked',
        'The Doors - Yes, the River Knows         ',
        '->',
        'The Doors - Yes, The River Knows - Rough Mix',
        '+18.0s +rough',
        'Waiting for the Sun (50th)'
      ].join('  ')
    );
    expect(second.split('\t')[1].startsWith('        Zero 7 - In the Waiting Line')).to.be.true;
    // the arrow and the differences start in the same column on every line
    const column = (line, text) => line.split('\t')[1].indexOf(text);
    expect(column(first, '->')).to.equal(column(second, '->'));
    expect(column(first, '+18.0s')).to.equal(column(second, '0.0s'));
  });
});
