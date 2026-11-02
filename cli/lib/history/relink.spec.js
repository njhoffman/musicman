const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { relinkHistory } = require('./relink.js');

describe('History relink', () => {
  let db;
  const tagPaths = () => db.prepare('SELECT path FROM tag_changes ORDER BY id').all();

  beforeEach(() => {
    db = openDatabase(':memory:');
    db.prepare(
      `INSERT INTO history_runs (id, command, args, started_at) VALUES ('run-1', 'edit', '[]', 'now')`
    ).run();
    const insert = db.prepare(
      `INSERT INTO tag_changes (run_id, path, frame, before, after_hash) VALUES ('run-1', ?, ?, NULL, 'h')`
    );
    insert.run('/music/a.mp3', 'TIT2');
    insert.run('/music/a.mp3', 'TPE1');
    insert.run('/music/b.mp3', 'TIT2');
    db.prepare(
      `INSERT INTO match_changes (run_id, song_id, path, before, after_hash) VALUES ('run-1', 1, 'a.mp3', 'null', 'h')`
    ).run();
  });

  afterEach(() => db.close());

  it('should move the tag changes of a file to its new path and count them', () => {
    const moved = relinkHistory(db, [{ from: '/music/a.mp3', to: '/music/x/a.mp3' }]);
    expect(moved).to.equal(2);
    expect(tagPaths()).to.deep.equal([
      { path: '/music/x/a.mp3' },
      { path: '/music/x/a.mp3' },
      { path: '/music/b.mp3' }
    ]);
  });

  it('should show the new library path of match changes with a base directory', () => {
    relinkHistory(db, [{ from: '/music/a.mp3', to: '/music/x/a.mp3' }], {
      baseDirectory: '/music'
    });
    expect(db.prepare('SELECT path FROM match_changes').get()).to.deep.equal({ path: 'x/a.mp3' });
  });

  it('should leave the history alone for unknown files and moves to the same path', () => {
    expect(
      relinkHistory(db, [
        { from: '/music/none.mp3', to: '/music/y.mp3' },
        { from: '/music/b.mp3', to: '/music/b.mp3' }
      ])
    ).to.equal(0);
    expect(tagPaths()).to.deep.equal([
      { path: '/music/a.mp3' },
      { path: '/music/a.mp3' },
      { path: '/music/b.mp3' }
    ]);
  });

  it('should compare resolved paths', () => {
    expect(relinkHistory(db, [{ from: '/music/x/../b.mp3', to: '/music/c.mp3' }])).to.equal(1);
  });
});
