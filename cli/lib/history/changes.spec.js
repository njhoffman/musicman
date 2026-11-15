const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../db/database.js');
const { syncTagDefinitions } = require('../db/tags.js');
const { updateDatabase } = require('../db/update.js');
const { updateTags } = require('../metadata/write.js');
const { beginJournal, endJournal, journaledMatch, pruneHistory } = require('./journal.js');
const { fieldChanges, hostName, matchDecision, songIdentity } = require('./changes.js');

describe('Change log', () => {
  let db;
  let library;
  let config;
  const file = name => path.join(library, name);
  const changes = () =>
    db
      .prepare(
        'SELECT host, song_hash, song_path, kind, field, value, previous, run_id, origin FROM changes ORDER BY id'
      )
      .all()
      .map(row => ({ ...row }));
  const begin = id =>
    beginJournal({
      run: { id, command: 'edit', args: ['edit'], startedAt: new Date('2026-11-15T00:00:00Z') },
      config,
      db
    });

  beforeEach(async () => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-changes-'));
    fs.cpSync(path.join(process.cwd(), 'test/data/source/dir1'), library, { recursive: true });
    config = {
      mpd: { baseDirectory: library },
      db: { backupDirectory: library },
      rating: { tag: 'POPM', max: 5 },
      delimiter: ',',
      hostSync: { name: 'charon' },
      library: {
        tags: [
          { id: 'TPE1', name: 'artist' },
          { id: 'TIT2', name: 'title' },
          { id: 'TIT1', name: 'grouping' },
          { id: 'TXXX.mood', name: 'mood', multi: true }
        ]
      },
      tags: [{ id: 'TXXX.mood', name: 'mood', multi: true }]
    };
    db = openDatabase(':memory:');
    syncTagDefinitions(db, config);
    await updateDatabase(db, { config, target: library });
  });

  afterEach(() => {
    endJournal();
    db.close();
    fs.rmSync(library, { recursive: true, force: true });
  });

  it('should name this computer by hostSync.name, else the hostname', () => {
    expect(hostName({ hostSync: { name: 'minerva' } })).to.equal('minerva');
    expect(hostName({}, 'charon')).to.equal('charon');
  });

  it('should turn field values into sets, and multi values into adds and removes', () => {
    const before = {
      TIT1: 'Rock',
      TXXX: [{ description: 'mood', value: 'Calm, Dreamy' }],
      POPM: { email: 'a', rating: 204, counter: 3 }
    };
    const after = {
      TIT1: 'Folk',
      TXXX: [{ description: 'mood', value: 'Dreamy, Upbeat' }],
      POPM: { email: 'b', rating: 204, counter: 9 }
    };
    expect(fieldChanges(before, after, config)).to.deep.equal([
      { kind: 'set', field: 'grouping', value: 'Folk', previous: 'Rock' },
      { kind: 'add', field: 'mood', value: 'Upbeat', previous: null },
      { kind: 'remove', field: 'mood', value: 'Calm', previous: null }
    ]);
    // the rating, not POPM's email or play counter
    expect(
      fieldChanges(before, { ...before, POPM: { email: 'a', rating: 255, counter: 3 } }, config)
    ).to.deep.equal([{ kind: 'set', field: 'rating', value: '5.0', previous: '4.0' }]);
    expect(fieldChanges({}, { TIT1: 'Rock' }, config)).to.deep.equal([
      { kind: 'set', field: 'grouping', value: 'Rock', previous: null }
    ]);
    expect(fieldChanges({ TIT1: 'Rock' }, {}, config)).to.deep.equal([
      { kind: 'set', field: 'grouping', value: null, previous: 'Rock' }
    ]);
  });

  it('should log the field changes of a journaled write with the song identity and the run', () => {
    const name = 'testFile02.mp3';
    const song = songIdentity(db, { relativePath: name });
    expect(song.hash).to.match(/^[0-9a-f]{64}$/);
    begin('r1');
    updateTags(
      {
        TIT1: 'Rock',
        userDefinedText: [{ description: 'mood', value: 'Calm, Dreamy' }],
        popularimeter: { email: 'x', rating: 230, counter: 0 }
      },
      file(name)
    );
    endJournal();
    expect(changes()).to.deep.equal(
      [
        { kind: 'set', field: 'grouping', value: 'Rock', previous: null },
        { kind: 'add', field: 'mood', value: 'Calm', previous: null },
        { kind: 'add', field: 'mood', value: 'Dreamy', previous: null },
        // the file was rated 3.5
        { kind: 'set', field: 'rating', value: '4.5', previous: '3.5' }
      ].map(entry => ({
        host: 'charon',
        song_hash: song.hash,
        song_path: name,
        run_id: 'r1',
        origin: null,
        ...entry
      }))
    );
  });

  it('should log nothing without a run or for a write that changes no field, and outlive pruning', () => {
    updateTags({ TIT1: 'Unlogged' }, file('testFile01.mp3'));
    expect(changes()).to.be.empty;
    begin('r2');
    updateTags({ TIT1: 'Rock' }, file('testFile01.mp3'));
    updateTags({ TIT1: 'Rock' }, file('testFile01.mp3'));
    endJournal();
    expect(changes()).to.have.length(1);
    pruneHistory(db, 0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM history_runs').get().n).to.equal(0);
    expect(changes()).to.have.length(1);
  });

  it('should log a match decision, not when it was looked up', () => {
    const { id } = db.prepare("SELECT id FROM songs WHERE path = 'testFile03.mp3'").get();
    const upsert = (status, checked) =>
      db
        .prepare(
          `INSERT INTO spotify_matches (song_id, status, track_id, checked_at) VALUES (?, ?, 'tid', ?)
           ON CONFLICT (song_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`
        )
        .run(id, status, checked);
    begin('r3');
    journaledMatch(db, id, () => upsert('review', '2026-11-01'));
    // looked up again, the same decision
    journaledMatch(db, id, () => upsert('review', '2026-11-02'));
    journaledMatch(db, id, () => upsert('match', '2026-11-02'));
    endJournal();
    const logged = changes();
    expect(logged.map(({ kind, value }) => [kind, JSON.parse(value).status])).to.deep.equal([
      ['match', 'review'],
      ['match', 'match']
    ]);
    expect(logged[0].previous).to.equal(null);
    expect(JSON.parse(logged[1].previous).status).to.equal('review');
    expect(matchDecision(null)).to.equal(null);
  });

  it('should name a file the database does not hold by its path alone', () => {
    expect(songIdentity(db, { relativePath: 'new/song.mp3' })).to.deep.equal({
      hash: null,
      mbid: null,
      spotify: null,
      path: 'new/song.mp3'
    });
  });
});
