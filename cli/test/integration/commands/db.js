const fs = require('fs');
const os = require('os');
const path = require('path');
const dbFunc = require('../../../lib/commands/db.js').func;

describe('Db Command', () => {
  let library;
  let config;
  const options = switches => ({ switches, filters: {}, assignments: {} });

  beforeEach(() => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-db-'));
    fs.cpSync(path.join(process.cwd(), 'test/data/source'), path.join(library, 'music'), {
      recursive: true
    });
    config = {
      mpd: { baseDirectory: path.join(library, 'music') },
      db: { path: path.join(library, 'db', 'musicman.sqlite') },
      rating: { tag: 'POPM', max: 5 },
      library: { tags: [{ id: 'TPE1', name: 'artist' }] },
      tags: [{ id: 'TXXX.Mood', name: 'mood', multi: true }]
    };
  });

  afterEach(() => {
    process.exitCode = undefined;
    fs.rmSync(library, { recursive: true, force: true });
  });

  it('Should create the database and show empty stats', async () => {
    const { stats } = await dbFunc({
      target: config.mpd.baseDirectory,
      options: options({}),
      config
    });
    expect(fs.existsSync(config.db.path)).to.be.true;
    expect(stats).to.include({ songs: 0, schemaVersion: 1, lastUpdate: null, lastBackup: null });
    expect(stats.tagDefinitions).to.be.greaterThan(100);
  });

  it('Should update the database with the update switch', async () => {
    const { summary, stats } = await dbFunc({
      target: config.mpd.baseDirectory,
      options: options({ update: true }),
      config
    });
    expect(summary).to.include({ added: 16, failed: 0 });
    expect(stats).to.include({ songs: 16 });
    expect(stats.lastUpdate).to.include({ added: 16 });
  });

  it('Should stop with an error when a stored custom field definition changed', async () => {
    await dbFunc({ target: config.mpd.baseDirectory, options: options({}), config });
    const changedConfig = { ...config, tags: [{ id: 'TXXX.Mood', name: 'mood' }] };
    const result = await dbFunc({
      target: config.mpd.baseDirectory,
      options: options({}),
      config: changedConfig
    });
    expect(result).to.be.false;
    expect(process.exitCode).to.equal(1);
  });
});
