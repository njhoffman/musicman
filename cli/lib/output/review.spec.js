const { expect } = require('chai');
const { stripAnsi } = require('../utils/logger.js');
const { matchSimilarity } = require('../spotify/match.js');
const { reviewBinds, reviewDifferences, reviewLines, sortForDecision } = require('./review.js');

describe('Review Output', () => {
  const items = [
    {
      file: '/m/a.mp3',
      linked: true,
      song: { artist: 'The Doors', title: 'Yes, the River Knows', duration: 260 },
      candidate: {
        id: 'doors-id',
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
        id: 'zero-id',
        artists: 'Zero 7',
        name: 'In The Waiting Line',
        album: 'Simple Things',
        durationMs: 200000
      }
    }
  ].map(item => ({ ...item, similarity: matchSimilarity(item.song, item.candidate) }));

  it('should give the duration difference and the title words only one side has', () => {
    expect(reviewDifferences(items[0])).to.equal('+18.0s +rough');
    expect(reviewDifferences(items[1])).to.equal('0.0s -radio');
  });

  it('should key aligned review columns by file for fzf', () => {
    const lines = reviewLines(items);
    const [first, second] = ['/m/a.mp3', '/m/b.mp3'].map(file => stripAnsi(lines.get(file)));
    expect(first.split('\t').slice(0, 2)).to.deep.equal(['/m/a.mp3', 'doors-id']);
    expect(first.split('\t')[2]).to.equal(
      [
        ' 86%',
        '\uf0c1',
        'The Doors - Yes, the River Knows         ',
        '\u2192',
        'The Doors - Yes, The River Knows - Rough Mix',
        '+18.0s +rough',
        'Waiting for the Sun (50th)'
      ].join('  ')
    );
    expect(second.split('\t')[2].startsWith(' 90%     Zero 7 - In the Waiting Line')).to.be.true;
    // the arrow and the differences start in the same column on every line
    const column = (line, text) => line.split('\t')[2].indexOf(text);
    expect(column(first, '\u2192')).to.equal(column(second, '\u2192'));
    expect(column(first, '+18.0s')).to.equal(column(second, '0.0s'));
  });

  it('should offer the most similar first to accept and the least similar first to reject', () => {
    const files = list => list.map(({ file }) => file);
    expect(files(sortForDecision(items, true))).to.deep.equal(['/m/b.mp3', '/m/a.mp3']);
    expect(files(sortForDecision(items, false))).to.deep.equal(['/m/a.mp3', '/m/b.mp3']);
  });

  it('should bind keys that play the song, play the Spotify track, and stop', () => {
    const [local, spotify, stop] = reviewBinds('/tmp/player.pid');
    expect(local).to.match(/^ctrl-l:execute-silent:/);
    expect(local).to.include('mpv --no-video --really-quiet {1}');
    expect(local).to.include('echo $! > /tmp/player.pid');
    expect(spotify).to.match(
      /^ctrl-s:execute-silent:.*playerctl -p spotify open spotify:track:\{2\}/
    );
    expect(stop).to.match(/^ctrl-x:execute-silent:.*kill "\$\(cat \/tmp\/player.pid\)"/);
  });
});
