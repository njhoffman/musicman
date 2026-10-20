const _ = require('lodash');
const path = require('path');

const statsFunc = require('../../../lib/commands/stats.js').func;
const { resetSandbox } = require('../../utils.js');

describe('Stats Command', () => {
  const dirTarget = path.join(process.cwd(), 'test/data/sandbox');

  const config = {
    rating: { tag: 'POPM', max: 5, email: 'fake@email.com' },
    mpd: {
      baseDirectory: dirTarget
    },
    stats: {
      multiFields: ['context', 'mood'],
      filters: [
        { name: 'All Songs > 4.0', filter: 'rating:4.0' },
        { name: 'All Songs > 5.0', filter: 'rating:5.0' },
        { name: 'Upbeat > 4.5', filter: 'rating:4.5 mood:upbeat' },
        { name: 'Total', filter: 'rating:5.0' }
      ]
    },
    library: {
      tags: [
        {
          id: 'TPE1',
          name: 'artist',
          viewIndex: 1
        },
        {
          id: 'TIT2',
          name: 'title',
          viewIndex: 2
        },
        {
          id: 'TXXX.CustomField',
          name: 'customfield',
          viewIndex: 3
        },
        {
          id: 'TXXX.Mood',
          name: 'mood',
          viewIndex: 4,
          multi: true
        },
        { id: 'TXXX.Context', name: 'context', multi: true },
        { id: 'TCON', name: 'genre' },
        { id: 'TIT1', name: 'grouping' }
      ]
    }
  };

  const options = { switches: {}, filters: {}, assignments: {} };

  beforeEach(function() {
    resetSandbox();
  });

  // eslint-disable-next-line no-control-regex
  const stripAnsi = str => str.replace(/\u001b\[[0-9;]*m/g, '');
  // output lines with color and left padding removed
  const runStats = async multiFields => {
    const statsConfig = { ...config, stats: { ...config.stats, multiFields } };
    const output = await statsFunc({ target: dirTarget, options, config: statsConfig });
    return stripAnsi(output)
      .split('\n')
      .map(line => line.trim());
  };

  it('Should output stats with the default multiFields', async () => {
    const lines = await runStats(['context', 'mood']);
    ['Genres', 'Groupings', 'Context', 'Mood', 'Ratings', 'Overall'].forEach(section =>
      expect(lines).to.include(section)
    );
    expect(lines).to.not.include('Picks');
  });

  it('Should output a section for each configured multi field', async () => {
    const lines = await runStats(['mood']);
    expect(lines).to.include('Mood');
    expect(lines).to.not.include('Context');
  });

  it('Should not duplicate genre when configured as a multi field', async () => {
    const lines = await runStats(['genre', 'mood']);
    expect(lines.filter(line => line === 'Genres')).to.have.length(1);
    expect(lines).to.not.include('Genre');
  });

  it('Should count multi field values across files', async () => {
    const lines = await runStats(['mood']);
    const moodSection = lines.slice(lines.indexOf('Mood') + 1, lines.indexOf('Ratings'));
    expect(moodSection).to.include('Upbeat 2');
  });

  it('Should count populated tags across files', async () => {
    const lines = await runStats(['mood']);
    const header = lines.find(line => /^Tags \(\d+ files\)$/.test(line));
    const total = Number(header.match(/\d+/)[0]);
    const tagRows = lines.slice(lines.indexOf(header) + 1).filter(Boolean);
    const artistRow = tagRows.find(line => line.startsWith('artist '));
    expect(artistRow.split(/\s+/)).to.deep.equal(['artist', `${total}`, '100%', 'TPE1']);
    expect(tagRows.some(line => line.startsWith('mood '))).to.be.true;
  });
});
