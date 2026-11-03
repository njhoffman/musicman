const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter, PassThrough } = require('stream');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { analysisWrites, keyName, runAnalysis, songsToAnalyze } = require('./essentia.js');

const result = (file, extra = {}) => ({
  file,
  bpm: 98.6,
  key: 'Bb',
  scale: 'minor',
  danceability: 1.182,
  moods: { happy: 0.802, sad: 0.385, relaxed: 0.414, aggressive: 0.028, party: 0.279 },
  ...extra
});

describe('Essentia analysis', () => {
  it('should write keys with sharps, minor with m', () => {
    expect(keyName('Bb', 'minor')).to.equal('A#m');
    expect(keyName('G', 'major')).to.equal('G');
    expect(keyName('', 'major')).to.equal(null);
  });

  it('should fill tempo and key only where empty, and the rest into es_ fields', () => {
    const now = new Date('2026-11-03T10:00:00Z');
    const empty = analysisWrites(result('a.mp3'), { now });
    expect(empty.standard).to.deep.equal({ TBPM: '99', TKEY: 'A#m' });
    expect(empty.custom).to.deep.equal([
      { name: 'es_danceability', value: '1.18' },
      { name: 'es_mood_happy', value: '0.80' },
      { name: 'es_mood_sad', value: '0.39' },
      { name: 'es_mood_relaxed', value: '0.41' },
      { name: 'es_mood_aggressive', value: '0.03' },
      { name: 'es_mood_party', value: '0.28' },
      { name: 'es_analyzed_at', value: '2026-11-03' }
    ]);
    // ReccoBeats' tempo and key stay
    const filled = analysisWrites(result('a.mp3'), { current: { TBPM: '165', TKEY: 'C#' } });
    expect(filled.standard).to.deep.equal({});
    const some = analysisWrites(result('a.mp3'), { fields: ['mood_party'] });
    expect(some.custom.map(({ name }) => name)).to.deep.equal(['es_mood_party', 'es_analyzed_at']);
  });

  it('should pick the songs not analysed yet, all with refresh, the first N with a limit', () => {
    const db = openDatabase(':memory:');
    ['a.mp3', 'b.mp3', 'c.mp3'].forEach((p, i) =>
      db.prepare('INSERT INTO songs (id, path, mtime, size) VALUES (?, ?, 0, 0)').run(i + 1, p)
    );
    db.prepare(
      "INSERT INTO song_tags (song_id, frame_id, value) VALUES (2, 'TXXX.es_analyzed_at', '2026-11-01')"
    ).run();
    expect(songsToAnalyze(db)).to.deep.equal(['a.mp3', 'c.mp3']);
    expect(songsToAnalyze(db, { refresh: true })).to.deep.equal(['a.mp3', 'b.mp3', 'c.mp3']);
    expect(songsToAnalyze(db, { limit: 1 })).to.deep.equal(['a.mp3']);
    db.close();
  });

  it('should share the files among the workers, one at a time each, and report every result', async () => {
    const spawned = [];
    // a worker answers each file it is given with its result line
    const spawnProcess = () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      let buffer = '';
      child.stdin.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(file => child.stdout.write(`${JSON.stringify(result(file))}\n`));
      });
      child.stdin.on('finish', () => {
        child.stdout.end();
        child.stderr.end();
        setImmediate(() => child.emit('close', 0));
      });
      spawned.push(child);
      return child;
    };
    const results = [];
    const files = ['1.mp3', '2.mp3', '3.mp3', '4.mp3', '5.mp3'];
    const { done } = runAnalysis({
      files,
      workers: 2,
      spawnProcess,
      onResult: r => results.push(r.file)
    });
    await done;
    expect(spawned).to.have.length(2);
    expect(results.sort()).to.deep.equal(files);
    // never more workers than files
    const one = runAnalysis({ files: ['x.mp3'], workers: 4, spawnProcess, onResult: () => {} });
    await one.done;
    expect(spawned).to.have.length(3);
  });

  describe('analyze', () => {
    const { func: analyze } = require('../commands/analyze.js');
    let root;
    let config;

    beforeEach(async () => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-analyze-'));
      const library = path.join(root, 'music');
      fs.mkdirSync(library);
      ['a.mp3', 'b.mp3'].forEach(name =>
        fs.copyFileSync(
          path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'),
          path.join(library, name)
        )
      );
      NodeId3.update({ TBPM: '120' }, path.join(library, 'b.mp3'));
      config = {
        mpd: { baseDirectory: library },
        db: { path: path.join(root, 'musicman.sqlite'), backupDirectory: path.join(root, 'b') },
        library: {
          tags: [
            { name: 'bpm', id: 'TBPM' },
            { name: 'key', id: 'TKEY' },
            { name: 'es_mood_happy', id: 'TXXX.es_mood_happy' },
            { name: 'es_analyzed_at', id: 'TXXX.es_analyzed_at' }
          ]
        },
        tags: [],
        analyze: { workers: 2 }
      };
      const db = require('../db/index.js').openLibrary(config);
      await require('../db/update.js').updateDatabase(db, { config, target: library });
      db.close();
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    // the analysis without Essentia: each file's result, b.mp3 failing when told to
    const fakeRun =
      ({ fail = null } = {}) =>
      ({ files, onResult }) => {
        files.forEach(file =>
          onResult(file.endsWith(fail) ? { file, error: 'cannot decode' } : result(file))
        );
        return { done: Promise.resolve() };
      };

    it('should write the analysis to the files and the database, and skip analysed songs next time', async () => {
      const told = await analyze({
        options: { switches: {} },
        config,
        run: fakeRun(),
        confirm: async () => false
      });
      expect(told.analyze).to.include({ songs: 2, written: 0 });
      const res = await analyze({ options: { switches: { yes: true } }, config, run: fakeRun() });
      expect(res.analyze).to.include({ songs: 2, written: 2 });
      const tags = name => NodeId3.read(path.join(config.mpd.baseDirectory, name)).raw;
      expect(tags('a.mp3')).to.include({ TBPM: '99', TKEY: 'A#m' });
      // b.mp3 had a tempo, which stays
      expect(tags('b.mp3').TBPM).to.equal('120');
      const custom = Object.fromEntries(
        [].concat(tags('a.mp3').TXXX).map(t => [t.description, t.value])
      );
      expect(custom).to.include({ es_mood_happy: '0.80', es_mood_party: '0.28' });
      const db = openDatabase(config.db.path);
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM song_tags WHERE frame_id = 'TXXX.es_analyzed_at'")
          .get().n
      ).to.equal(2);
      db.close();
      expect(
        (await analyze({ options: { switches: { yes: true } }, config, run: fakeRun() })).analyze
      ).to.include({
        songs: 0
      });
    });

    it('should list the files that fail and leave them for the next run, and refuse a bad limit', async () => {
      const res = await analyze({
        options: { switches: { yes: true } },
        config,
        run: fakeRun({ fail: 'b.mp3' })
      });
      expect(res.analyze.written).to.equal(1);
      expect(res.analyze.failed).to.deep.equal([{ file: 'b.mp3', error: 'cannot decode' }]);
      const next = await analyze({
        options: { switches: { dryRun: true } },
        config,
        run: fakeRun()
      });
      expect(next.analyze).to.include({ songs: 1, dryRun: true });
      await analyze({ options: { switches: { limit: 'x' } }, config }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.match(/--limit needs a positive number/)
      );
    });
  });
});
