const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { selectChecks } = require('../check/index.js');
const { renderReport, run } = require('./check.js');

describe('Check command', () => {
  const config = {
    mpd: { baseDirectory: '/music' },
    db: { path: __filename },
    library: { tags: [] },
    rating: { tag: 'POPM', max: 5 }
  };

  // a database with songs in two folders, a.mp3 holding the leftover Spotify frame
  const libraryDb = () => {
    const db = openDatabase(':memory:');
    ['rock/a.mp3', 'jazz/b.mp3'].forEach(file => {
      const { lastInsertRowid: id } = db
        .prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)')
        .run(file);
      if (file === 'rock/a.mp3') {
        db.prepare(
          "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.spotify_track_id', 't')"
        ).run(id);
      }
    });
    return db;
  };

  it('should run the named checks only, and refuse unknown ones', () => {
    expect(selectChecks('names, Duplicates').map(({ name }) => name)).to.deep.equal([
      'names',
      'duplicates'
    ]);
    expect(selectChecks()).to.have.length(11);
    expect(() => selectChecks('names,typo')).to.throw('Unknown check typo; checks are drift');
  });

  it('should check the songs under the target with the database checks', async () => {
    const options = { switches: { only: 'spotify-id,rating' } };
    const whole = await run({ config, options, openDb: libraryDb, list: () => [] });
    expect(whole.map(({ name, findings }) => [name, findings.length])).to.deep.equal([
      ['spotify-id', 1],
      ['rating', 0]
    ]);
    const jazz = await run({
      target: '/music/jazz',
      config,
      options,
      openDb: libraryDb,
      list: () => []
    });
    expect(jazz[0].findings).to.deep.equal([]);
    await run({ target: '/elsewhere', config, options, openDb: libraryDb, list: () => [] }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.include('is not inside mpd.baseDirectory')
    );
  });

  it('should fail without a library database', async () => {
    await run({
      config: { ...config, db: { path: '/nonexistent/musicman.sqlite' } },
      openDb: libraryDb,
      list: () => []
    }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.include('run: musicman db --update')
    );
  });

  it('should report counts, the first 10 findings per check, and a summary', () => {
    const findings = Array.from({ length: 12 }, (_, i) => ({ file: `f${i}.mp3`, detail: 'x' }));
    const results = [
      { name: 'drift', description: 'database and files differ', unit: 'file', findings: [] },
      {
        name: 'names',
        description: 'names',
        unit: 'group',
        findings: [{ file: null, detail: 'A / a' }]
      },
      { name: 'spotify-id', description: 'leftover', unit: 'file', findings }
    ];
    const lines = renderReport(results);
    expect(lines[0]).to.match(/^drift +ok +database and files differ$/);
    expect(lines[1]).to.match(/^names +1 group +names$/);
    expect(lines[2]).to.equal('    A / a');
    expect(lines).to.include('    ... 2 more (--all, or --only=spotify-id --all)');
    expect(lines[lines.length - 1]).to.equal('2 checks of 3 found problems');
    expect(renderReport(results, { all: true })).to.include('    f11.mp3  x');
    expect(renderReport([results[0]]).pop()).to.equal('No problems found in 1 check');
  });
});
