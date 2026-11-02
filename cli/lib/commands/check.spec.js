const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { selectChecks } = require('../check/index.js');
const { run } = require('./check.js');

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
    expect(selectChecks()).to.have.length(14);
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

  describe('--fix with duplicates', () => {
    // a Singles copy of an album song (trashed by rule) and one single in two grouping folders (picked)
    const duplicatesDb = () => {
      const db = openDatabase(':memory:');
      [
        ['Rated/G/Artists/A/album/2000 - Album/01 - Song.mp3', 't1'],
        ['Rated/G/Singles/A - Song.mp3', 't1'],
        ['Rated/X/Singles/B - Tune.mp3', 't2'],
        ['Rated/Y/Singles/B - Tune.mp3', 't2']
      ].forEach(([file, trackId]) => {
        const { lastInsertRowid: id } = db
          .prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)')
          .run(file);
        db.prepare(
          "INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', ?)"
        ).run(id, trackId);
      });
      return db;
    };
    const options = switches => ({ switches: { only: 'duplicates', fix: true, ...switches } });

    it('should only show the plan in a dry run, with the groups to pick left out', async () => {
      const { fixed } = await run({
        config,
        options: options({ dryRun: true }),
        openDb: duplicatesDb,
        list: () => [],
        confirm: async () => expect.fail('should not ask')
      });
      expect(fixed.duplicates.dryRun).to.be.true;
      expect(fixed.duplicates.groups.map(({ keep, trash }) => [keep, trash])).to.deep.equal([
        ['Rated/G/Artists/A/album/2000 - Album/01 - Song.mp3', ['Rated/G/Singles/A - Song.mp3']]
      ]);
      expect(fixed.duplicates.toPick.map(({ candidates }) => candidates)).to.deep.equal([
        ['Rated/X/Singles/B - Tune.mp3', 'Rated/Y/Singles/B - Tune.mp3']
      ]);
    });

    it('should ask once before repairing the groups the rules decide', async () => {
      const asked = [];
      const { fixed } = await run({
        config,
        options: options(),
        openDb: duplicatesDb,
        list: () => [],
        confirm: async question => asked.push(question) && false
      });
      expect(asked).to.deep.equal(['Repair 1 duplicate group: move 1 file to the trash?']);
      expect(fixed.duplicates.removed).to.be.empty;
    });

    it('should go through the groups to pick with --pick, showing what tells the copies apart', async () => {
      const picks = [];
      const { fixed } = await run({
        config,
        options: { switches: { pick: true } },
        openDb: duplicatesDb,
        list: () => [],
        pick: (lines, settings) => {
          picks.push({ lines, settings });
          return ['skip'];
        }
      });
      expect(picks).to.have.length(1);
      expect(picks[0].settings.header).to.match(
        /^Duplicates 1\/1: different audio, same length 0:00/
      );
      expect(picks[0].lines.map(line => line.split('\t')[0])).to.deep.equal([
        '/music/Rated/X/Singles/B - Tune.mp3',
        '/music/Rated/Y/Singles/B - Tune.mp3',
        'skip',
        'stop'
      ]);
      expect(picks[0].lines[0].split('\t')[1]).to.equal(
        'Rated/X/Singles/B - Tune.mp3  0:00  0.0 MB  crc ?  unrated  no title'
      );
      expect(fixed).to.include({ picked: 0, skipped: 1 });
    });
  });

  it('should not count songs taken out of the library as drift', async () => {
    const db = libraryDb();
    db.prepare("INSERT INTO excluded_songs (path) VALUES ('comp/c.mp3')").run();
    const [drift] = await run({
      config,
      options: { switches: { only: 'drift' } },
      openDb: () => db,
      list: () => ['/music/comp/c.mp3', '/music/new.mp3']
    });
    const files = drift.findings.map(({ file }) => file);
    expect(files).to.include('new.mp3');
    expect(files).to.not.include('comp/c.mp3');
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
});
