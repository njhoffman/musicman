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
    // a numbered copy (decided by rule) and one single in two grouping folders (picked)
    const duplicatesDb = () => {
      const db = openDatabase(':memory:');
      [
        ['Rated/G/Singles/A - Song.mp3', 't1'],
        ['Rated/G/Singles/A - Song.1.mp3', 't1'],
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

    it('should only show the plan in a dry run', async () => {
      const picks = [];
      const { fixed } = await run({
        config,
        options: options({ dryRun: true }),
        openDb: duplicatesDb,
        list: () => [],
        confirm: async () => true,
        pick: (...args) => picks.push(args) && []
      });
      expect(fixed.duplicates.dryRun).to.be.true;
      expect(
        fixed.duplicates.groups.map(({ keep, remove, candidates }) => [keep, remove, candidates])
      ).to.deep.equal([
        ['Rated/G/Singles/A - Song.mp3', ['Rated/G/Singles/A - Song.1.mp3'], []],
        [null, [], ['Rated/X/Singles/B - Tune.mp3', 'Rated/Y/Singles/B - Tune.mp3']]
      ]);
      expect(picks).to.be.empty;
    });

    it('should pick the copy to keep, then the groups to apply, before asking', async () => {
      const picks = [];
      const asked = [];
      const { fixed } = await run({
        config,
        options: options(),
        openDb: duplicatesDb,
        list: () => [],
        confirm: async question => asked.push(question) && false,
        pick: (lines, settings) => {
          picks.push({ lines, settings });
          // keep the Y copy, then apply only the second group
          return settings.prompt === 'keep' ? ['/music/Rated/Y/Singles/B - Tune.mp3'] : ['1'];
        }
      });
      expect(picks.map(({ settings }) => settings.prompt)).to.deep.equal(['keep', 'apply']);
      expect(picks[1].settings.binds).to.deep.equal(['start:select-all']);
      expect(picks[1].lines.map(line => line.split('\t')[1])).to.deep.equal([
        'keep Rated/G/Singles/A - Song.mp3  remove 1',
        'keep Rated/Y/Singles/B - Tune.mp3  remove 1'
      ]);
      expect(fixed.duplicates.groups.map(({ keep, remove }) => [keep, remove])).to.deep.equal([
        ['Rated/Y/Singles/B - Tune.mp3', ['Rated/X/Singles/B - Tune.mp3']]
      ]);
      expect(asked).to.deep.equal(['Move 1 copy to the trash?']);
      expect(fixed.duplicates.removed).to.be.empty;
    });
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
