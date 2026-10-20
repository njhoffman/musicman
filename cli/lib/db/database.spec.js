const { expect } = require('chai');
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
        'meta',
        'song_tags',
        'songs',
        'spotify_matches',
        'spotify_playlist_tracks',
        'spotify_playlists',
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
});
