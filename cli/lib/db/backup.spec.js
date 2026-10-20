const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { expect } = require('chai');

const { getMeta, openDatabase } = require('./database.js');
const { backupDatabase, backupIfDue, listBackups } = require('./backup.js');

describe('Database Backup', () => {
  let db;
  let directory;
  let config;
  const day = 24 * 60 * 60 * 1000;
  const addSong = file =>
    db.prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)').run(file);

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-backup-'));
    db = openDatabase(path.join(directory, 'musicman.sqlite'));
    config = {
      db: {
        backupDirectory: path.join(directory, 'backups'),
        backupInterval: '1 day',
        backupCount: 2
      }
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should write a readable copy of the database and record it', () => {
    addSong('a.mp3');
    const backup = backupDatabase(db, config, new Date('2026-10-20T10:11:12Z'));
    expect(path.basename(backup.file)).to.equal('musicman-20261020-101112.sqlite');

    const copy = new DatabaseSync(backup.file, { readOnly: true });
    expect(
      copy
        .prepare('SELECT path FROM songs')
        .all()
        .map(row => row.path)
    ).to.deep.equal(['a.mp3']);
    copy.close();
    expect(getMeta(db, 'lastBackup')).to.include({
      file: backup.file,
      at: '2026-10-20T10:11:12.000Z'
    });
  });

  it('should keep only the newest db.backupCount backups', () => {
    addSong('a.mp3');
    ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'].forEach(date =>
      backupDatabase(db, config, new Date(`${date}T00:00:00Z`))
    );
    expect(listBackups(config.db.backupDirectory)).to.deep.equal([
      'musicman-20261019-000000.sqlite',
      'musicman-20261020-000000.sqlite'
    ]);
  });

  it('should not back up an empty database', () => {
    expect(backupIfDue(db, config)).to.be.null;
    expect(listBackups(config.db.backupDirectory)).to.be.empty;
  });

  it('should back up when there is no previous backup', () => {
    addSong('a.mp3');
    expect(backupIfDue(db, config)).to.not.be.null;
  });

  it('should back up only once the interval has passed since the last backup', () => {
    addSong('a.mp3');
    const now = new Date('2026-10-20T00:00:00Z');
    backupDatabase(db, config, now);
    expect(backupIfDue(db, config, new Date(now.getTime() + day - 1000))).to.be.null;
    expect(backupIfDue(db, config, new Date(now.getTime() + day))).to.not.be.null;
  });
});
