const fs = require('fs');
const os = require('os');
const path = require('path');
const search = require('../../../lib/commands/search.js');
const dbFunc = require('../../../lib/commands/db.js').func;
const { startFakeMpd } = require('../../fakeMpd.js');

describe('Search Command', () => {
  let library;
  let config;
  let mpd;
  const options = (terms, switches = {}) => ({ switches, filters: {}, assignments: {}, terms });
  const run = (terms, switches) =>
    search.func({ target: config.mpd.baseDirectory, options: options(terms, switches), config });
  const titles = ({ results }) => results.map(([, meta]) => meta.title).sort();

  before(async () => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-search-'));
    fs.cpSync(path.join(process.cwd(), 'test/data/source'), path.join(library, 'music'), {
      recursive: true
    });
    mpd = await startFakeMpd();
    config = {
      mpd: { baseDirectory: path.join(library, 'music'), ...mpd.config },
      db: {
        path: path.join(library, 'musicman.sqlite'),
        backupDirectory: path.join(library, 'backups')
      },
      rating: { tag: 'POPM', max: 5 },
      library: {
        tags: [
          { id: 'TPE1', name: 'artist' },
          { id: 'TIT2', name: 'title' },
          { id: 'TALB', name: 'album' },
          { id: 'TXXX.Mood', name: 'mood', multi: true }
        ]
      },
      tags: [{ id: 'TXXX.Mood', name: 'mood', multi: true }]
    };
    await dbFunc({
      target: config.mpd.baseDirectory,
      options: options([], { update: true }),
      config
    });
  });

  after(async () => {
    await mpd.close();
    fs.rmSync(library, { recursive: true, force: true });
  });

  beforeEach(() => {
    mpd.commands.length = 0;
  });

  describe('parseTerms', () => {
    it('Should split field filters, mpc style pairs, and free text', () => {
      const { filters, words } = search.parseTerms(
        ['artist:Artist A', 'mood', 'Happy', 'Silence', '~album', 'x', 'unknown:value'],
        config
      );
      expect(filters.include).to.deep.equal({ artist: 'Artist A', mood: ['Happy'] });
      expect(filters.exclude).to.deep.equal({ album: 'x' });
      expect(words).to.deep.equal(['silence', 'unknown:value']);
    });

    it('Should not treat numbers as ratings unless given as a rating field', () => {
      expect(search.parseTerms(['1999'], config).words).to.deep.equal(['1999']);
      expect(search.parseTerms(['rating', '4.5'], config).filters.rating).to.include({
        min: '4.5'
      });
    });
  });

  it('Should find songs by free text in the artist or title', async () => {
    expect(titles(await run(['minutes', 'silence']))).to.deep.equal([
      '10 minutes of silence',
      '2 minutes and 30 seconds of silence'
    ]);
    const { results } = await run(['j']);
    expect(results).to.not.be.empty;
    results.forEach(([, meta]) =>
      expect(`${meta.artist} ${meta.title}`.toLowerCase()).to.include('j')
    );
  });

  it('Should find songs by field filters across the whole library', async () => {
    const { results } = await run(['mood:Happy']);
    expect(results.map(([file]) => path.relative(config.mpd.baseDirectory, file))).to.deep.equal([
      '1 minute of silence.mp3'
    ]);
    expect((await run(['rating:4.5'])).results.length).to.be.greaterThan(0);
  });

  it('Should return nothing without terms', async () => {
    expect(await run([])).to.deep.equal({ results: [] });
  });

  it('Should add results to the MPD queue with --add', async () => {
    const { queued } = await run(['mood:Happy'], { add: true });
    expect(queued).to.equal(1);
    expect(mpd.commands).to.deep.equal(['add "1 minute of silence.mp3"']);
  });

  it('Should replace the MPD queue and play results with --play', async () => {
    const { results, queued } = await run(['mood:Happy'], { play: true });
    expect(queued).to.equal(results.length);
    expect(mpd.commands).to.deep.equal(['clear', 'add "1 minute of silence.mp3"', 'play']);
  });
});
