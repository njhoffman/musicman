const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { expect } = require('chai');

const migrations = require('./migrations.js');
const { openDatabase, setMeta, getMeta } = require('./database.js');
const { findRestorable, listRestorable, restoreDatabase } = require('./restore.js');
const { func: dbCommand } = require('../commands/db.js');

describe('Database restore', () => {
  let root;
  let config;
  // a library database holding one meta value, at file
  const database = (file, value) => {
    const db = openDatabase(file);
    setMeta(db, 'marker', value);
    db.close();
  };
  const marker = file => {
    const db = openDatabase(file);
    try {
      return getMeta(db, 'marker');
    } finally {
      db.close();
    }
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-restore-'));
    config = {
      mpd: { baseDirectory: root },
      db: { path: path.join(root, 'musicman.sqlite'), backupDirectory: path.join(root, 'backups') },
      logger: { archive: { directory: path.join(root, 'runs') } }
    };
    fs.mkdirSync(config.db.backupDirectory);
    database(config.db.path, 'current');
    database(path.join(config.db.backupDirectory, 'musicman-20261029-022707.sqlite'), 'october');
    database(
      path.join(config.db.backupDirectory, 'musicman-before-rebuild-20261020.sqlite'),
      'named'
    );
    fs.writeFileSync(path.join(config.db.backupDirectory, 'spotify-recheck.txt'), 'not a database');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should list automatic and named backups with their schema, and find one by a part of its name', () => {
    const copies = listRestorable(config.db.backupDirectory);
    expect(copies.map(copy => copy.name).sort()).to.deep.equal([
      'musicman-20261029-022707.sqlite',
      'musicman-before-rebuild-20261020.sqlite'
    ]);
    expect(copies[0]).to.include({ version: migrations.length, newer: false });
    expect(findRestorable(copies, 'musicman-20261029-022707').name).to.equal(
      'musicman-20261029-022707.sqlite'
    );
    expect(findRestorable(copies, 'rebuild').name).to.equal(
      'musicman-before-rebuild-20261020.sqlite'
    );
    expect(findRestorable(copies, 'nothing')).to.equal(null);
    expect(() => findRestorable(copies, 'musicman-')).to.throw(/matches 2 backups/);
  });

  it('should save the current database, put the copy in place, and drop the old -wal and -shm', () => {
    fs.writeFileSync(`${config.db.path}-wal`, 'stale');
    fs.writeFileSync(`${config.db.path}-shm`, 'stale');
    const copy = findRestorable(listRestorable(config.db.backupDirectory), '20261029');
    const { saved } = restoreDatabase({ config, copy, now: new Date('2026-11-03T10:00:00Z') });
    expect(path.basename(saved)).to.equal('musicman-before-restore-20261103-100000.sqlite');
    expect(marker(saved)).to.equal('current');
    expect(marker(config.db.path)).to.equal('october');
    expect(fs.existsSync(`${config.db.path}-shm`)).to.equal(false);
  });

  it('should refuse a copy with a newer schema than this musicman', () => {
    const newer = path.join(config.db.backupDirectory, 'musicman-future.sqlite');
    const db = new DatabaseSync(newer);
    db.exec(`PRAGMA user_version = ${migrations.length + 1}`);
    db.close();
    const copy = findRestorable(listRestorable(config.db.backupDirectory), 'future');
    expect(copy).to.include({ newer: true });
    expect(() => restoreDatabase({ config, copy })).to.throw(/newer than this musicman supports/);
    expect(marker(config.db.path)).to.equal('current');
  });

  describe('db --restore', () => {
    const restore = (terms, switches = {}, deps = {}) =>
      dbCommand({
        target: root,
        options: { terms, switches: { restore: true, ...switches } },
        config,
        running: () => [],
        ...deps
      });

    afterEach(() => {
      process.exitCode = undefined;
    });

    it('should list the backups without a name, and restore one only when told yes', async () => {
      expect((await restore([])).backups).to.have.length(2);
      const asked = [];
      const no = await restore(
        ['20261029'],
        {},
        {
          confirm: async question => {
            asked.push(question);
            return false;
          }
        }
      );
      expect(no).to.deep.equal({ restored: null });
      expect(asked[0]).to.match(
        /^Replace the library database with musicman-20261029-022707.sqlite/
      );
      expect(marker(config.db.path)).to.equal('current');
      const yes = await restore(['20261029'], { yes: true });
      expect(yes.restored).to.equal('musicman-20261029-022707.sqlite');
      expect(marker(config.db.path)).to.equal('october');
    });

    it('should refuse while another musicman run is going, or for a name no backup has', async () => {
      const busy = await restore(
        ['20261029'],
        { yes: true },
        {
          running: () => [{ command: 'ui', pid: 42 }]
        }
      );
      expect(busy).to.equal(false);
      expect(process.exitCode).to.equal(1);
      expect(marker(config.db.path)).to.equal('current');
      expect(await restore(['nothing'], { yes: true })).to.equal(false);
    });
  });
});
