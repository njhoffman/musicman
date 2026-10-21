const { expect } = require('chai');
const chalk = require('chalk').default;
const { emitFormatted, songColumns, songOneline, songRecords } = require('./emit.js');
const { stripAnsi } = require('../utils/logger.js');

describe('Formatted Output', () => {
  const config = {
    delimiter: ';',
    rating: { color: '#BBDDFF' },
    views: {
      table: {
        tags: [
          { name: 'rating' },
          { name: 'artist' },
          { name: 'title' },
          { name: 'album' },
          { name: 'mood' }
        ]
      }
    }
  };
  const pairs = [
    [
      '/m/a.mp3',
      {
        rating: '4.5',
        artist: 'The Doors',
        title: 'Riders',
        album: 'L.A. Woman',
        mood: 'Dark',
        genre: 'Rock'
      }
    ],
    ['/m/b.mp3', { artist: 'Nico', title: 'These Days' }]
  ];
  let originalLevel;

  beforeEach(() => {
    originalLevel = chalk.level;
  });

  afterEach(() => {
    chalk.level = originalLevel;
  });

  it('should use the view table tags after --include or --exclude', () => {
    expect(songColumns(config)).to.deep.equal(['rating', 'artist', 'title', 'album', 'mood']);
    expect(songColumns(config, { include: ['title', 'artist'] })).to.deep.equal([
      'artist',
      'title'
    ]);
    expect(songColumns(config, { exclude: ['mood', 'album'] })).to.deep.equal([
      'rating',
      'artist',
      'title'
    ]);
  });

  it('should build song records with the path and view tags only', () => {
    expect(songRecords(pairs, ['artist', 'mood'])).to.deep.equal([
      { path: '/m/a.mp3', artist: 'The Doors', mood: 'Dark' },
      { path: '/m/b.mp3', artist: 'Nico' }
    ]);
  });

  it('should write a song oneline as path, tab, rating, artist - title, album, and the rest', () => {
    const [first, second] = songRecords(pairs, songColumns(config)).map(songOneline(config));
    expect(stripAnsi(first)).to.equal('/m/a.mp3\t4.5 The Doors - Riders [L.A. Woman] Dark');
    expect(stripAnsi(second)).to.equal('/m/b.mp3\t-.- Nico - These Days');
  });

  it('should write the format to stdout with the configured csv delimiter', () => {
    const written = [];
    emitFormatted({
      switches: { format: 'csv' },
      config,
      records: [{ a: 1, b: 'x;y' }],
      columns: ['a', 'b'],
      write: text => written.push(text)
    });
    expect(written).to.deep.equal(['a;b\n1;"x;y"\n']);
  });

  it('should color oneline output even when it is piped, unless NO_COLOR is set', () => {
    const { NO_COLOR } = process.env;
    const emit = () => {
      const written = [];
      chalk.level = 0;
      emitFormatted({
        switches: { format: 'oneline' },
        config,
        records: [{ path: '/m/a.mp3' }],
        oneline: () => `key\t${chalk.red('text')}`,
        write: text => written.push(text)
      });
      return written[0];
    };
    try {
      delete process.env.NO_COLOR;
      expect(emit()).to.include('\u001b[');
      process.env.NO_COLOR = '1';
      expect(emit()).to.equal('key\ttext\n');
    } finally {
      if (NO_COLOR === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = NO_COLOR;
      }
    }
  });

  it('should pass oneline lines to the picker for --fzf and write the picked keys', () => {
    const written = [];
    let picked;
    const result = emitFormatted({
      switches: { fzf: true },
      config,
      title: 'search',
      records: songRecords(pairs, ['artist']),
      oneline: record => `${record.path}\t${record.artist}`,
      preview: 'preview {1}',
      pick: (lines, options) => {
        picked = { lines, options };
        return ['/m/b.mp3'];
      },
      write: text => written.push(text)
    });
    expect(picked.lines).to.deep.equal(['/m/a.mp3\tThe Doors', '/m/b.mp3\tNico']);
    expect(picked.options).to.deep.equal({ preview: 'preview {1}', prompt: 'search' });
    expect(result).to.deep.equal({ format: 'oneline', selected: ['/m/b.mp3'] });
    expect(written).to.deep.equal(['/m/b.mp3\n']);
  });

  it('should write nothing when nothing is picked', () => {
    const written = [];
    emitFormatted({
      switches: { fzf: true },
      config,
      records: [],
      oneline: String,
      pick: () => [],
      write: text => written.push(text)
    });
    expect(written).to.be.empty;
  });
});
