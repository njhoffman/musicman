const { expect } = require('chai');
const { outputStats, statsOneline, statsSections } = require('./stats.js');

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
    ratings: { 4.5: 2, '5.0': 1 },
    size: 2048,
    duration: 600,
    total: 4,
    tags: [
      { id: 'TPE1', name: 'artist', count: 4 },
      { id: 'TXXX.Mood', name: 'mood', count: 3 },
      { id: 'TXXX.ASIN', name: 'TXXX:ASIN', count: 1 }
    ]
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
    expect(output).to.include('Tags (4 files)');
  });

  it('should render sorted value counts', () => {
    const output = stripAnsi(outputStats({ stats }));
    const moodLines = output.split('Mood\n')[1].split('\n').slice(0, 2);
    expect(moodLines.map(line => line.trim())).to.deep.equal(['Happy 3', 'Sad 1']);
  });

  it('should render tag counts with percentages in tag order', () => {
    const output = stripAnsi(outputStats({ stats }));
    const tagLines = output
      .split('Tags (4 files)\n')[1]
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.trim().split(/\s+/));
    expect(tagLines).to.deep.equal([
      ['artist', '4', '100%', 'TPE1'],
      ['mood', '3', '75%', 'TXXX.Mood'],
      ['TXXX:ASIN', '1', '25%', 'TXXX.ASIN']
    ]);
  });

  it('should round percentages down and show counts under 1% as <1%', () => {
    const tags = [
      { id: 'APIC', name: 'image', count: 948 },
      { id: 'TPE1', name: 'artist', count: 951 },
      { id: 'TKEY', name: 'key', count: 1 }
    ];
    const output = stripAnsi(outputStats({ stats: { ...stats, tags, total: 951 } }));
    const percents = output
      .split('Tags (951 files)\n')[1]
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.trim().split(/\s+/)[2]);
    expect(percents).to.deep.equal(['99%', '100%', '<1%']);
  });

  it('should render an empty tags section when no files matched', () => {
    const output = stripAnsi(outputStats({ stats: { ...stats, tags: [], total: 0 } }));
    expect(output.trim().endsWith('Tags (0 files)')).to.be.true;
  });

  it('should render totals', () => {
    const output = stripAnsi(outputStats({ stats }));
    expect(output).to.include('tracks_rated 3');
    expect(output).to.include('total_duration 10 min');
    expect(output).to.include('total_size 2 MB');
  });
  it('should give record sections for --format, one per field and for totals and tags', () => {
    const sections = statsSections(stats);
    expect(sections.map(({ heading }) => heading)).to.deep.equal([
      'Genres',
      'Groupings',
      'Mood',
      'Picks',
      'Ratings',
      'Overall',
      'Tags'
    ]);
    expect(sections[2].records).to.deep.equal([
      { value: 'Happy', count: 3 },
      { value: 'Sad', count: 1 }
    ]);
    expect(sections[5].records[2]).to.deep.equal({ value: 'total_duration_min', count: 10 });
  });

  it('should key stats oneline lines by section and value', () => {
    const line = stripAnsi(statsOneline({ section: 'Mood', value: 'Sad', count: 1 }));
    expect(line).to.equal('Mood:Sad\tMood       Sad 1');
  });
});
