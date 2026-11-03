const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { func: dbCommand } = require('./db.js');
const { openLibrary, updateDatabase } = require('../db/index.js');
const { excludeSong, excludedPaths } = require('../db/exclusions.js');
const { beginJournal, endJournal } = require('../history/journal.js');
const { findHistoryRun, listHistory, planUndo } = require('../history/undo.js');

describe('db command: excluded songs', () => {
  let library;
  let config;
  const kept = 'Rated/G/Artists/A/album/2000 - Album/01 - Song.mp3';
  const comp = 'Rated/G/Artists/A/compilation/2010 - Hits/05 - Song.mp3';
  const other = 'Rated/G/Singles/B - Other.mp3';
  const abs = file => path.join(library, file);
  const songPaths = () => {
    const db = openLibrary(config);
    try {
      return db
        .prepare('SELECT path FROM songs ORDER BY path')
        .all()
        .map(row => row.path);
    } finally {
      db.close();
    }
  };
  const run = (switches, target, extra = {}) =>
    dbCommand({ target, options: { switches }, config, pick: null, ...extra });

  beforeEach(async () => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-db-'));
    const source = path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3');
    [kept, comp, other].forEach(file => {
      fs.mkdirSync(path.dirname(abs(file)), { recursive: true });
      fs.copyFileSync(source, abs(file));
    });
    config = {
      mpd: { baseDirectory: library },
      db: { path: path.join(library, 'musicman.sqlite'), backupDirectory: path.join(library, '.musicman') },
      rating: { tag: 'POPM', max: 5 },
      library: { tags: [{ id: 'TIT2', name: 'title' }] },
      tags: []
    };
    const db = openLibrary(config);
    await updateDatabase(db, { config, target: library });
    excludeSong(db, { path: comp, trackId: 't1', kept, reason: 'compilation copy of an album song' });
    excludeSong(db, { path: other, kept: null, reason: 'Unrated import of a Rated song' });
    db.close();
    fs.unlinkSync(abs(other));
  });

  afterEach(() => {
    endJournal();
    fs.rmSync(library, { recursive: true, force: true });
  });

  it('should list the exclusions, marking the ones whose file went to the trash', async () => {
    const { excluded } = await run({ excluded: true });
    expect(excluded.map(row => [row.path, row.inLibrary])).to.have.deep.members([
      [comp, true],
      [other, false]
    ]);
  });

  it('should readmit a file: no longer excluded, back in the database, recorded for undo', async () => {
    beginJournal({
      run: { id: 'r1', command: 'db', args: ['db', '--readmit'], startedAt: new Date() },
      config
    });
    const { readmitted } = await run({ readmit: true }, abs(comp));
    endJournal();
    expect(readmitted.map(row => row.path)).to.deep.equal([comp]);
    expect(songPaths()).to.include(comp);
    const db = openLibrary(config);
    try {
      expect([...excludedPaths(db)]).to.deep.equal([other]);
      const undo = planUndo(db, findHistoryRun(listHistory(db), 'r1'), { baseDirectory: library });
      expect(undo.moves.map(({ action, status }) => [action, status])).to.deep.equal([
        ['include', 'restore']
      ]);
    } finally {
      db.close();
    }
  });

  it('should pick among the exclusions under a directory, and leave a trashed copy out', async () => {
    const offered = [];
    const pick = lines => {
      offered.push(...lines.map(line => line.split('\t')[0]));
      return [comp, other];
    };
    const { readmitted } = await run({ readmit: true }, library, { pick });
    expect(offered).to.have.members([comp, other]);
    expect(readmitted.map(row => row.path)).to.deep.equal([comp]);
    const db = openLibrary(config);
    try {
      expect([...excludedPaths(db)]).to.deep.equal([other]);
    } finally {
      db.close();
    }
  });

  it('should refuse a path that is not excluded', async () => {
    const before = process.exitCode;
    const { readmitted } = await run({ readmit: true }, abs(kept));
    expect(readmitted).to.be.empty;
    expect(process.exitCode).to.equal(1);
    process.exitCode = before;
  });
});
