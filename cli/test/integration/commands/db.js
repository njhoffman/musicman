const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const dbFunc = require('../../../lib/commands/db.js').func;
const viewFunc = require('../../../lib/commands/view.js').func;
const statsFunc = require('../../../lib/commands/stats.js').func;
const editFunc = require('../../../lib/commands/edit.js').func;

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
      db: {
        path: path.join(library, 'db', 'musicman.sqlite'),
        backupDirectory: path.join(library, 'db', 'backups'),
        backupInterval: '1 day',
        backupCount: 7
      },
      rating: { tag: 'POPM', max: 5 },
      library: {
        tags: [
          { id: 'TPE1', name: 'artist' },
          { id: 'TIT2', name: 'title' },
          { id: 'TXXX.Mood', name: 'mood', multi: true },
          { id: 'TCON', name: 'genre' },
          { id: 'TIT1', name: 'grouping' }
        ]
      },
      tags: [{ id: 'TXXX.Mood', name: 'mood', multi: true }],
      stats: { multiFields: ['mood'] }
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

  it('Should back up the database with the backup switch', async () => {
    await dbFunc({ target: config.mpd.baseDirectory, options: options({ update: true }), config });
    const { backup, stats } = await dbFunc({ target: config.mpd.baseDirectory, options: options({ backup: true }), config });
    expect(fs.existsSync(backup.file)).to.be.true;
    expect(path.dirname(backup.file)).to.equal(config.db.backupDirectory);
    expect(stats.lastBackup).to.include({ file: backup.file });
  });

  it('Should back up before updating once songs exist and the interval has passed', async () => {
    const update = () => dbFunc({ target: config.mpd.baseDirectory, options: options({ update: true }), config });
    expect((await update()).stats.lastBackup).to.be.null;
    expect((await update()).stats.lastBackup).to.not.be.null;
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

  describe('Database backed commands', () => {
    const view = async (switches = {}) =>
      (
        await viewFunc({
          target: config.mpd.baseDirectory,
          options: options({ recursive: true, ...switches }),
          config
        })
      ).metadata;
    const update = () =>
      dbFunc({ target: config.mpd.baseDirectory, options: options({ update: true }), config });
    const songTitle = file => {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(config.db.path);
      const row = db
        .prepare(
          "SELECT value FROM song_tags JOIN songs ON songs.id = song_id WHERE path = ? AND frame_id = 'TIT2'"
        )
        .get(file);
      db.close();
      return row && row.value;
    };

    it('Should read the same metadata from the database as from the files', async () => {
      await update();
      const fromDatabase = await view();
      const fromFiles = await view({ files: true });
      // the database stores multi value fields as separate values, so trailing commas are not kept
      const normalize = metadata =>
        metadata.map(meta =>
          meta.mood ? { ...meta, mood: meta.mood.split(',').filter(Boolean) } : meta
        );
      expect(fromDatabase).to.have.length(16);
      expect(normalize(fromDatabase)).to.deep.equal(normalize(fromFiles));
    });

    it('Should read the same stats from the database as from the files', async () => {
      await update();
      const lines = output =>
        output
          .replace(/\u001b\[[0-9;]*m/g, '')
          .split('\n')
          .map(line => line.trim());
      const statsOptions = switches => options({ recursive: true, ...switches });
      const fromDatabase = await statsFunc({
        target: config.mpd.baseDirectory,
        options: statsOptions({}),
        config
      });
      const fromFiles = await statsFunc({
        target: config.mpd.baseDirectory,
        options: statsOptions({ files: true }),
        config
      });
      expect(lines(fromDatabase)).to.deep.equal(lines(fromFiles));
    });

    it('Should read files changed since the last update from disk', async () => {
      await update();
      const file = path.join(config.mpd.baseDirectory, 'dir1/testFile01.mp3');
      NodeId3.update({ title: 'Changed Title' }, file);
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
      const metadata = await view();
      expect(metadata.map(meta => meta.title)).to.include('Changed Title');
    });

    it('Should read files when the database does not exist', async () => {
      const metadata = await view();
      expect(metadata).to.have.length(16);
      expect(fs.existsSync(config.db.path)).to.be.false;
    });

    it('Should update database rows for edited files', async () => {
      await update();
      const target = path.join(config.mpd.baseDirectory, 'dir1/testFile02.mp3');
      await editFunc({
        target,
        options: { ...options({}), assignments: { title: 'Edited Title' } },
        config
      });
      expect(songTitle('dir1/testFile02.mp3')).to.equal('Edited Title');
    });
  });
});
