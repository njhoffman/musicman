const { expect } = require('chai');
const { outputStats } = require('./stats.js');

// eslint-disable-next-line no-control-regex
const stripAnsi = str => str.replace(/\u001b\[[0-9;]*m/g, '');

describe('Stats Output', () => {
  const stats = {
    fields: {
      genre: { Rock: 2 },
      grouping: {},
      mood: { Sad: 1, Happy: 3 },
      picks: { Best: 1 }
    },
    rated: 3,
    unrated: 1,
    ratings: { '4.5': 2, '5.0': 1 },
    size: 2048,
    duration: 600
  };

  it('should render a section for every field in config order', () => {
    const output = stripAnsi(outputStats({ stats }));
    const sections = output.split('\n').filter(line => /^\s*[A-Z][a-z]+$/.test(line));
    expect(sections.map(line => line.trim())).to.deep.equal([
      'Genres',
      'Groupings',
      'Mood',
      'Picks',
      'Ratings',
      'Overall'
    ]);
  });

  it('should render sorted value counts', () => {
    const output = stripAnsi(outputStats({ stats }));
    const moodLines = output.split('Mood\n')[1].split('\n').slice(0, 2);
    expect(moodLines.map(line => line.trim())).to.deep.equal(['Happy 3', 'Sad 1']);
  });

  it('should render totals', () => {
    const output = stripAnsi(outputStats({ stats }));
    expect(output).to.include('tracks_rated 3');
    expect(output).to.include('total_duration 10 min');
    expect(output).to.include('total_size 2 MB');
  });
});
