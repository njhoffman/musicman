const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { expect } = require('chai');
const { listRestorable } = require('./restore.js');
const { getMeta, migrate, openDatabase, setMeta, transaction } = require('./database.js');
const migrations = require('./migrations.js');

describe('Database', () => {
  let db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('openDatabase', () => {
    it('should create the schema and set the schema version', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map(({ name }) => name);
      expect(tables).to.deep.equal([
        'excluded_songs',
        'file_changes',
        'history_runs',
        'match_changes',
        'meta',
        'song_tags',
        'songs',
        'spotify_changes',
        'spotify_matches',
        'spotify_playlist_tracks',
        'spotify_playlists',
        'spotify_synced',
        'tag_changes',
        'tags'
      ]);
      expect(db.prepare('PRAGMA user_version').get().user_version).to.equal(migrations.length);
    });

    it('should enforce foreign keys so deleting a song deletes its tags', () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO songs (path, mtime, size) VALUES (?, ?, ?)')
        .run('a.mp3', 1, 1);
      db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)').run(
        lastInsertRowid,
        'TPE1',
        'A'
      );
      db.prepare('DELETE FROM songs WHERE id = ?').run(lastInsertRowid);
      expect(db.prepare('SELECT COUNT(*) AS n FROM song_tags').get().n).to.equal(0);
    });
  });

  describe('migrate', () => {
    it('should only apply migrations newer than the schema version', () => {
      const steps = migrations.concat(['CREATE TABLE extra (id INTEGER)']);
      expect(migrate(db, steps)).to.equal(steps.length);
      expect(db.prepare('PRAGMA user_version').get().user_version).to.equal(steps.length);
      expect(() => migrate(db, steps)).to.not.throw();
    });

    it('should roll back a failing migration and keep the schema version', () => {
      const steps = migrations.concat(['CREATE TABLE extra (id INTEGER); NOT VALID SQL']);
      expect(() => migrate(db, steps)).to.throw();
      expect(db.prepare('PRAGMA user_version').get().user_version).to.equal(migrations.length);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'extra'").get()).to.be
        .undefined;
    });

    it('should skip what another process applied while this one waited', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-migrate-'));
      const file = path.join(root, 'race.sqlite');
      const first = new DatabaseSync(file);
      const second = new DatabaseSync(file);
      try {
        const steps = ['CREATE TABLE one (id INTEGER)', 'CREATE TABLE two (id INTEGER)'];
        // the second process migrates after the first read the version, as during its copy
        migrate(first, steps, { before: () => migrate(second, steps) });
        expect(first.prepare('PRAGMA user_version').get().user_version).to.equal(2);
      } finally {
        first.close();
        second.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should fetch cached playlists again once their tracks have an isrc column', () => {
      const { DatabaseSync } = require('node:sqlite');
      const old = new DatabaseSync(':memory:');
      try {
        migrate(old, migrations.slice(0, 6));
        old
          .prepare("INSERT INTO spotify_playlists (id, name, snapshot_id) VALUES ('p', 'P', 's1')")
          .run();
        migrate(old);
        expect(
          old.prepare("SELECT snapshot_id FROM spotify_playlists WHERE id = 'p'").get()
        ).to.deep.equal({
          snapshot_id: null
        });
        expect(
          old
            .prepare('PRAGMA table_info(spotify_playlist_tracks)')
            .all()
            .map(column => column.name)
        ).to.include('isrc');
      } finally {
        old.close();
      }
    });

    it('should list library files by Spotify track id in spotify_track_files, marking excluded copies', () => {
      const song = db.prepare(
        'INSERT INTO songs (path, mtime, size, duration) VALUES (?, 0, 0, ?)'
      );
      const tag = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)');
      const kept = song.run('A/kept.mp3', 201.5).lastInsertRowid;
      const copy = song.run('A/copy.mp3', 201.4).lastInsertRowid;
      tag.run(kept, 'TXXX.sp_track_id', 'track1');
      tag.run(kept, 'TXXX.sp_album_id', 'album1');
      tag.run(copy, 'TXXX.sp_track_id', 'track1');
      db.prepare(
        "INSERT INTO excluded_songs (path, track_id) VALUES ('A/copy.mp3', 'track1')"
      ).run();
      const rows = db
        .prepare('SELECT * FROM spotify_track_files WHERE track_id = ? ORDER BY excluded, path')
        .all('track1');
      expect(rows.map(row => ({ ...row }))).to.deep.equal([
        { track_id: 'track1', path: 'A/kept.mp3', duration: 201.5, excluded: 0 },
        { track_id: 'track1', path: 'A/copy.mp3', duration: 201.4, excluded: 1 }
      ]);
    });

    it('should refuse a database with a newer schema version', () => {
      db.exec(`PRAGMA user_version = ${migrations.length + 1}`);
      expect(() => migrate(db)).to.throw('newer than this musicman supports');
    });
  });

  describe('transaction', () => {
    it('should roll back all writes when the function throws', () => {
      expect(() =>
        transaction(db, () => {
          db.prepare('INSERT INTO songs (path, mtime, size) VALUES (?, ?, ?)').run('a.mp3', 1, 1);
          throw new Error('failed');
        })
      ).to.throw('failed');
      expect(db.prepare('SELECT COUNT(*) AS n FROM songs').get().n).to.equal(0);
    });
  });

  describe('meta', () => {
    it('should store and replace JSON values by key', () => {
      expect(getMeta(db, 'lastUpdate')).to.be.null;
      setMeta(db, 'lastUpdate', { added: 1 });
      setMeta(db, 'lastUpdate', { added: 2 });
      expect(getMeta(db, 'lastUpdate')).to.deep.equal({ added: 2 });
    });
  });

  describe('the copy before a migration', () => {
    let root;
    let file;
    let backups;
    const target = migrations.length;
    const copyName = `musicman-before-schema-${target}.sqlite`;

    // a database at an old schema with one song, on disk
    const oldDatabase = (version = 5) => {
      const old = new DatabaseSync(file);
      migrate(old, migrations.slice(0, version));
      old.prepare("INSERT INTO songs (path, mtime, size) VALUES ('a.mp3', 1, 1)").run();
      old.close();
    };
    const open = (...args) => openDatabase(file, ...args).close();
    const read = (where, sql) => {
      const copy = new DatabaseSync(where, { readOnly: true });
      try {
        return copy.prepare(sql).get();
      } finally {
        copy.close();
      }
    };

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-before-schema-'));
      file = path.join(root, 'musicman.sqlite');
      backups = path.join(root, 'backups');
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('should save the database as it was, then migrate it, once', () => {
      oldDatabase();
      open({ backupDirectory: backups });
      const copy = path.join(backups, copyName);
      expect(read(copy, 'PRAGMA user_version').user_version).to.equal(5);
      expect(read(copy, 'SELECT path FROM songs').path).to.equal('a.mp3');
      expect(read(file, 'PRAGMA user_version').user_version).to.equal(target);
      open({ backupDirectory: backups });
      expect(fs.readdirSync(backups)).to.deep.equal([copyName]);
      // db --restore lists it with its schema
      expect(listRestorable(backups)[0]).to.include({ name: copyName, version: 5, newer: false });
    });

    it('should save it next to the database without a backup directory', () => {
      oldDatabase();
      open();
      expect(fs.readdirSync(path.join(root, '.musicman'))).to.deep.equal([copyName]);
    });

    it('should keep an earlier copy of that name', () => {
      oldDatabase();
      fs.mkdirSync(backups);
      fs.writeFileSync(path.join(backups, copyName), 'earlier');
      open({ backupDirectory: backups });
      expect(fs.readFileSync(path.join(backups, copyName), 'utf8')).to.equal('earlier');
      const others = fs.readdirSync(backups).filter(name => name !== copyName);
      expect(others).to.have.length(1);
      expect(others[0]).to.match(/^musicman-before-schema-\d+-\d{8}-\d{6}\.sqlite$/);
      expect(read(path.join(backups, others[0]), 'PRAGMA user_version').user_version).to.equal(5);
    });

    it('should not migrate when the copy cannot be written', () => {
      oldDatabase();
      // a file where the directory should be
      fs.writeFileSync(backups, '');
      expect(() => open({ backupDirectory: backups })).to.throw(
        new RegExp(`Database not migrated to schema ${target}: could not save a copy`)
      );
      expect(read(file, 'PRAGMA user_version').user_version).to.equal(5);
    });

    it('should save nothing for a new database, one up to date, or one in memory', () => {
      open({ backupDirectory: backups });
      open({ backupDirectory: backups });
      openDatabase(':memory:', { backupDirectory: backups }).close();
      expect(fs.existsSync(backups)).to.equal(false);
    });
  });
});
