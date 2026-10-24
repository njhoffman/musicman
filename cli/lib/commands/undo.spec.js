const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openLibrary, updateDatabase } = require('../db/index.js');
const { updateTags } = require('../metadata/write.js');
const { beginJournal, endJournal, recordSpotify } = require('../history/journal.js');
const undo = require('./undo.js');

describe('Undo Command', () => {
  let library;
  let config;
  let title;
  const file = name => path.join(library, name);
  const options = (terms, switches = {}) => ({ terms, switches });
  const runUndo = (terms, switches, extra = {}) =>
    undo.func({
      options: options(terms, switches),
      config,
      file: path.join(library, 'no-token.json'),
      ...extra
    });

  beforeEach(async () => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-undo-command-'));
    fs.cpSync(path.join(process.cwd(), 'test/data/source/dir1'), library, { recursive: true });
    config = {
      mpd: { baseDirectory: library },
      db: { path: path.join(library, 'musicman.sqlite') },
      rating: { tag: 'POPM', max: 5 },
      library: {
        tags: [
          { id: 'TPE1', name: 'artist' },
          { id: 'TIT2', name: 'title' }
        ]
      },
      tags: []
    };
    const db = openLibrary(config);
    await updateDatabase(db, { config, target: library });
    title = NodeId3.read(file('testFile01.mp3')).raw.TIT2;
    beginJournal({
      run: { id: '20261024-100000-edit', command: 'edit', args: ['edit'], startedAt: new Date() },
      config,
      db
    });
    updateTags({ TIT2: 'Edited' }, file('testFile01.mp3'));
    endJournal();
    db.close();
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
    fs.rmSync(library, { recursive: true, force: true });
  });

  it('should list the runs with changes without an id or with --list', async () => {
    const { runs } = await runUndo([]);
    expect(runs.map(({ id, files }) => [id, files])).to.deep.equal([['20261024-100000-edit', 1]]);
    expect((await runUndo(['latest'], { list: true })).runs).to.have.length(1);
  });

  it('should change nothing in a dry run or when the confirmation is declined', async () => {
    const { plan } = await runUndo(['latest'], { dryRun: true });
    expect(plan.files.map(({ status }) => status)).to.deep.equal(['restore']);
    await runUndo(['20261024'], {}, { confirm: async () => false });
    expect(NodeId3.read(file('testFile01.mp3')).raw.TIT2).to.equal('Edited');
  });

  it('should restore the files of a run once and refuse to undo it again', async () => {
    const { result } = await runUndo(['latest'], {}, { confirm: async () => true });
    expect(result.tags.restored).to.have.length(1);
    expect(NodeId3.read(file('testFile01.mp3')).raw.TIT2).to.equal(title);
    // the undo ran without a recorded run here, so the run is marked by hand like the cli would
    const db = openLibrary(config);
    db.prepare(
      "UPDATE history_runs SET undone_by = 'later' WHERE id = '20261024-100000-edit'"
    ).run();
    db.close();
    await runUndo(['latest'], {}, { confirm: async () => true });
    expect(process.exitCode).to.equal(1);
  });

  it('should refuse to undo Spotify changes without a Spotify login', async () => {
    const db = openLibrary(config);
    beginJournal({
      run: { id: '20261024-110000-sync', command: 'sync', args: [], startedAt: new Date() },
      config,
      db
    });
    recordSpotify({
      target: { id: 'liked', name: 'Liked Songs' },
      action: 'add',
      trackIds: ['t1']
    });
    endJournal();
    db.close();
    const confirmed = [];
    await runUndo(['20261024-110000'], {}, { confirm: async message => confirmed.push(message) });
    expect(process.exitCode).to.equal(1);
    expect(confirmed).to.be.empty;
  });

  it('should be archived only when it undoes something', () => {
    expect(undo.archive({ list: true })).to.be.false;
    expect(undo.archive({ dryRun: true })).to.be.false;
    expect(undo.archive({})).to.be.true;
  });
});
