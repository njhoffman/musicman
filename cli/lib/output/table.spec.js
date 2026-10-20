const { expect } = require('chai');
const chalk = require('chalk').default;
const { outputTable } = require('./table.js');

// eslint-disable-next-line no-control-regex
const stripAnsi = str => str.replace(/\u001b\[[0-9;]*m/g, '');
const renderLines = (metadata, config) => stripAnsi(outputTable(metadata, config)).split('\n');

describe('Table Output', () => {
  let originalColumns;
  let originalLevel;

  const config = {
    rating: { tag: 'POPM', max: 5 },
    library: {
      tags: [
        { id: 'TPE1', name: 'artist', maxWidth: 20 },
        { id: 'TIT2', name: 'title', maxWidth: 12 },
        { id: 'TALB', name: 'album' }
      ]
    },
    views: {
      table: {
        tags: [{ name: 'title' }, { name: 'rating' }, { name: 'artist', maxWidth: 8 }]
      }
    }
  };

  const metadata = [
    { rating: '4.5', artist: 'Artist 1', title: 'Title 1', album: 'Album 1' },
    { rating: '5.0', artist: 'Artist Two Long', title: 'A Much Longer Title', album: '' }
  ];

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalLevel = chalk.level;
    process.stdout.columns = 200;
  });

  afterEach(() => {
    process.stdout.columns = originalColumns;
    chalk.level = originalLevel;
  });

  it('should order columns by views.table.tags', () => {
    const [header] = renderLines(metadata, config);
    expect(header.split(/\s+/).filter(Boolean)).to.deep.equal(['Title', 'Rating', 'Artist']);
  });

  it('should only include tags listed in views.table.tags', () => {
    const output = renderLines(metadata, config).join('\n');
    expect(output).to.not.include('Album');
  });

  it('should truncate cells to tag maxWidth with view entry overrides', () => {
    const [, , row2] = renderLines(metadata, config);
    expect(row2).to.include('A Much Long…');
    expect(row2).to.include('Artist …');
    expect(row2).to.not.include('Artist Two');
  });

  it('should center align the rating column', () => {
    const [header, row1] = renderLines(metadata, config);
    const ratingStart = header.indexOf('Rating');
    expect(row1.slice(ratingStart, ratingStart + 6)).to.equal(' 4.5  ');
  });

  it('should omit columns that are empty for all files', () => {
    const viewConfig = {
      ...config,
      views: { table: { tags: [{ name: 'album' }, { name: 'title' }] } }
    };
    const [header] = renderLines([{ title: 'Title 1', album: '' }], viewConfig);
    expect(header.trim()).to.equal('Title');
  });

  it('should hide headers when views.table.headers.visible is false', () => {
    const viewConfig = {
      ...config,
      views: { table: { ...config.views.table, headers: { visible: false } } }
    };
    const lines = renderLines(metadata, viewConfig);
    expect(lines).to.have.length(2);
    expect(lines[0]).to.include('Title 1');
  });

  it('should capitalize headers when views.table.headers.capitalize is set', () => {
    const viewConfig = {
      ...config,
      views: { table: { ...config.views.table, headers: { capitalize: true } } }
    };
    const [header] = renderLines(metadata, viewConfig);
    expect(header).to.include('TITLE');
  });

  it('should drop columns past the terminal width and truncate the one crossing it', () => {
    process.stdout.columns = 16;
    const lines = renderLines(metadata, config);
    lines.forEach(line => expect(line.length).to.be.at.most(16));
    expect(lines[0]).to.not.include('Artist');
    expect(lines[0]).to.include('Ra…');
  });

  it('should truncate colored cells by visible width', () => {
    chalk.level = 1;
    const viewConfig = {
      ...config,
      views: { table: { ...config.views.table, color: '#FF0000' } }
    };
    const output = outputTable(metadata, viewConfig);
    expect(output).to.match(/\u001b\[/);
    expect(stripAnsi(output).split('\n')[2]).to.include('A Much Long…');
  });

  it('should output nothing when views.table is not configured', () => {
    expect(outputTable(metadata, { rating: config.rating })).to.equal('');
  });
});
