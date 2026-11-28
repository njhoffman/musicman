const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter, PassThrough } = require('stream');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const {
  analysisWrites,
  keyName,
  pickStyles,
  runAnalysis,
  songsToAnalyze,
  songsWithoutStyles,
  styleSettings
} = require('./essentia.js');

const result = (file, extra = {}) => ({
  file,
  bpm: 98.6,
  key: 'Bb',
  scale: 'minor',
  danceability: 1.182,
  moods: { happy: 0.802, sad: 0.385, relaxed: 0.414, aggressive: 0.028, party: 0.279 },
  ...extra
});

// the script's styles: the best 5 [name, score] pairs
const styles = [
  ['Alternative Rock', 0.338],
  ['Indie Rock', 0.258],
  ['Brit Pop', 0.229],
  ['Pop Rock', 0.2],
  ['Soft Rock', 0.062]
];

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

  it('should pick at most max styles, each over min and the relative share of the best', () => {
    // the defaults: over 0.12 and half of 0.338, at most 3
    expect(pickStyles(styles)).to.deep.equal(['Alternative Rock', 'Indie Rock', 'Brit Pop']);
    expect(pickStyles(styles, { min: 0.12, relative: 0.7, max: 3 })).to.deep.equal([
      'Alternative Rock',
      'Indie Rock'
    ]);
    expect(pickStyles(styles, { min: 0.3, relative: 0, max: 5 })).to.deep.equal([
      'Alternative Rock'
    ]);
    expect(pickStyles(styles, { min: 0.1, relative: 0, max: 5 })).to.have.length(4);
    // no score is sure enough, or no scores
    expect(pickStyles([['Grime', 0.08]])).to.deep.equal([]);
    expect(pickStyles([])).to.deep.equal([]);
    // analyze.styles overrides some of the defaults
    expect(styleSettings({ analyze: { styles: { max: 2 } } })).to.deep.equal({
      min: 0.12,
      relative: 0.5,
      max: 2
    });
    expect(styleSettings({})).to.deep.equal({ min: 0.12, relative: 0.5, max: 3 });
  });

  it('should write the chosen styles and their scores, and leave fields a styles only result lacks', () => {
    const now = new Date('2026-11-28T10:00:00Z');
    const full = analysisWrites(result('a.mp3', { styles }), { now });
    expect(full.custom).to.deep.include({
      name: 'es_styles',
      value: 'Alternative Rock,Indie Rock,Brit Pop'
    });
    expect(full.custom).to.deep.include({
      name: 'es_style_scores',
      value: 'Alternative Rock=0.34; Indie Rock=0.26; Brit Pop=0.23; Pop Rock=0.20; Soft Rock=0.06'
    });
    // a styles only analysis: no tempo, key, danceability or moods to write
    const only = analysisWrites({ file: 'a.mp3', styles }, { now });
    expect(only.standard).to.deep.equal({});
    expect(only.custom.map(({ name }) => name)).to.deep.equal([
      'es_styles',
      'es_style_scores',
      'es_analyzed_at'
    ]);
    // none sure enough: es_styles is emptied, so a refresh clears the old ones
    const none = analysisWrites({ file: 'a.mp3', styles: [['Grime', 0.08]] }, { now });
    expect(none.custom[0]).to.deep.equal({ name: 'es_styles', value: '' });
    // the settings reach the pick, and a result without styles writes neither field
    const two = analysisWrites(
      { file: 'a.mp3', styles },
      { styles: { min: 0, relative: 0, max: 2 } }
    );
    expect(two.custom[0].value).to.equal('Alternative Rock,Indie Rock');
    const without = analysisWrites(result('a.mp3'), { now });
    expect(_.map(without.custom, 'name')).to.not.include('es_styles');
  });

  it('should pick the analysed songs without styles for a styles only analysis', () => {
    const db = openDatabase(':memory:');
    ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3'].forEach((p, i) =>
      db.prepare('INSERT INTO songs (id, path, mtime, size) VALUES (?, ?, 0, 0)').run(i + 1, p)
    );
    const tag = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)');
    // a: not analysed; b and d: analysed before styles; c: analysed with them
    [2, 3, 4].forEach(id => tag.run(id, 'TXXX.es_analyzed_at', '2026-11-01'));
    tag.run(3, 'TXXX.es_style_scores', 'Ambient=0.43');
    expect(songsWithoutStyles(db)).to.deep.equal(['b.mp3', 'd.mp3']);
    expect(songsWithoutStyles(db, { limit: 1 })).to.deep.equal(['b.mp3']);
    expect(songsToAnalyze(db)).to.deep.equal(['a.mp3']);
    db.close();
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
    // a file with parts goes to the script as path<TAB>parts
    const lines = [];
    const recording = () => {
      const child = spawnProcess();
      child.stdin.on('data', chunk => lines.push(...String(chunk).split('\n').filter(Boolean)));
      return child;
    };
    await runAnalysis({
      files: ['x.mp3', { file: 'y.mp3', parts: ['styles'] }],
      workers: 1,
      spawnProcess: recording,
      onResult: () => {}
    }).done;
    expect(lines).to.deep.equal(['x.mp3', 'y.mp3\tstyles']);
    spawned.length = 0;
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

    // finish: the worker ends after the file it has, and active counts the workers still running; this
    // worker answers on the next turn, as a real one does
    const slowSpawn = () => {
      const child = spawnProcess();
      const { write } = child.stdout;
      child.stdout.write = (...args) => setImmediate(() => write.apply(child.stdout, args));
      return child;
    };
    const finished = [];
    const run = runAnalysis({
      files,
      workers: 1,
      spawnProcess: slowSpawn,
      onResult: r => {
        finished.push(r.file);
        run.finish();
      }
    });
    expect(run.active()).to.equal(1);
    await run.done;
    expect(finished).to.deep.equal(['1.mp3']);
    expect(run.active()).to.equal(0);
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
            { name: 'es_styles', id: 'TXXX.es_styles', multi: true },
            { name: 'es_style_scores', id: 'TXXX.es_style_scores' },
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

    // the analysis without Essentia: each file's result (only the styles for a styles only file), b.mp3
    // failing when told to; sent lists what each run was given
    let sent = [];
    const fakeRun =
      ({ fail = null, withStyles = true } = {}) =>
      ({ files, onResult }) => {
        sent = files;
        files.forEach(entry => {
          const file = _.isString(entry) ? entry : entry.file;
          const only = !_.isString(entry);
          if (file.endsWith(fail)) {
            onResult({ file, error: 'cannot decode' });
          } else if (only) {
            onResult({ file, styles });
          } else {
            onResult(result(file, withStyles ? { styles } : {}));
          }
        });
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

    it('should give songs analysed before styles their styles alone, and count them in --limit', async () => {
      // analysed before styles were a field: no es_style_scores
      await analyze({
        options: { switches: { yes: true } },
        config,
        run: fakeRun({ withStyles: false })
      });
      const dry = await analyze({
        options: { switches: { dryRun: true } },
        config,
        run: fakeRun()
      });
      expect(dry.analyze).to.include({ songs: 2, written: 0 });
      // --limit 1 takes one of them
      const one = await analyze({
        options: { switches: { yes: true, limit: '1' } },
        config,
        run: fakeRun()
      });
      expect(one.analyze).to.include({ songs: 1, written: 1 });
      expect(sent).to.deep.equal([
        { file: path.join(config.mpd.baseDirectory, 'a.mp3'), parts: ['styles'] }
      ]);
      const custom = name =>
        Object.fromEntries(
          []
            .concat(NodeId3.read(path.join(config.mpd.baseDirectory, name)).raw.TXXX)
            .map(t => [t.description, t.value])
        );
      expect(custom('a.mp3')).to.include({
        es_styles: 'Alternative Rock,Indie Rock,Brit Pop',
        es_mood_happy: '0.80'
      });
      // the rest, then nothing; without styles in analyze.fields they are not asked for
      await analyze({ options: { switches: { yes: true } }, config, run: fakeRun() });
      expect(
        (await analyze({ options: { switches: { dryRun: true } }, config, run: fakeRun() })).analyze
      ).to.include({ songs: 0 });
      const db = openDatabase(config.db.path);
      db.prepare("DELETE FROM song_tags WHERE frame_id = 'TXXX.es_style_scores'").run();
      db.close();
      const moodsOnly = { ...config, analyze: { workers: 2, fields: ['mood_happy'] } };
      expect(
        (
          await analyze({
            options: { switches: { dryRun: true } },
            config: moodsOnly,
            run: fakeRun()
          })
        ).analyze
      ).to.include({ songs: 0 });
    });

    describe('--idle', () => {
      // a run whose files arrive when told: release() reports them all, finish is recorded
      const heldRun = () => {
        const calls = { finish: 0, workers: null };
        let release;
        const run = ({ files, workers, onResult }) => {
          calls.workers = workers;
          return {
            done: new Promise(resolve => {
              release = () => {
                files.forEach(file => onResult(result(file)));
                resolve();
              };
            }),
            finish: () => {
              calls.finish += 1;
            },
            active: () => workers
          };
        };
        return { run, calls, release: () => release() };
      };
      const ready = () => ({ ready: true, reason: '2 songs to analyse' });
      const lock = () => () => {};

      it('should do nothing when not idle, and say why', async () => {
        const res = await analyze({
          options: { switches: { idle: true } },
          config,
          check: () => ({ ready: false, reason: 'on battery' }),
          run: () => expect.fail('should not analyse'),
          lock: () => expect.fail('should not take the lock')
        });
        expect(res.analyze).to.deep.equal({ songs: 0, written: 0, idle: 'on battery' });
      });

      it('should analyse with analyze.idle.workers without asking, and finish when the watch stops it', async () => {
        const held = heldRun();
        let stop;
        let unwatched = false;
        const pending = analyze({
          options: { switches: { idle: true } },
          config: { ...config, analyze: { workers: 4, idle: { workers: 1 } } },
          check: ready,
          lock,
          run: held.run,
          confirm: () => expect.fail('should not ask'),
          watch: ({ stop: stopRun, workers }) => {
            expect(workers()).to.equal(1);
            stop = stopRun;
            return () => {
              unwatched = true;
            };
          }
        });
        await new Promise(resolve => setImmediate(resolve));
        stop('on battery');
        expect(held.calls).to.deep.equal({ finish: 1, workers: 1 });
        held.release();
        const res = await pending;
        expect(res.analyze).to.include({ songs: 2, written: 2, stopped: 'on battery' });
        expect(unwatched).to.equal(true);
      });

      it('should leave a held lock alone in the background and refuse a manual run', async () => {
        const held = () => {
          const err = new Error('another musicman analyze is running (pid 7)');
          err.holder = 7;
          throw err;
        };
        const res = await analyze({
          options: { switches: { idle: true } },
          config,
          check: ready,
          lock: held
        });
        expect(res.analyze.idle).to.equal('another musicman analyze is running (pid 7)');
        await analyze({ options: { switches: { yes: true } }, config, lock: held }).then(
          () => expect.fail('should reject'),
          err =>
            expect(err.message).to.equal(
              'another musicman analyze is running (pid 7), the background one stops with: systemctl --user stop musicman-analyze'
            )
        );
        await analyze({ options: { switches: { idle: true, limit: '3' } }, config }).then(
          () => expect.fail('should reject'),
          err => expect(err.message).to.match(/--idle takes no other switches/)
        );
      });

      it('should release the lock after a run, and archive only a run that will analyse', async () => {
        let released = 0;
        await analyze({
          options: { switches: { yes: true } },
          config,
          run: fakeRun(),
          lock: () => () => {
            released += 1;
          }
        });
        expect(released).to.equal(1);
        const command = require('../commands/analyze.js');
        const quiet = { one: 0, five: 0, fifteen: 0.2 };
        const deps = { load: () => quiet, battery: () => false, holder: () => null };
        // every song was analysed above
        expect(command.idleCheck(config, deps)).to.deep.equal({
          ready: false,
          reason: 'every song is analysed'
        });
        expect(command.idleCheck(config, { ...deps, battery: () => true }).ready).to.equal(false);
        expect(command.archive({ dryRun: true }, config)).to.equal(false);
        expect(command.archive({}, config)).to.equal(true);
      });
    });

    it('should list the files that fail and leave them for the next run, and refuse a bad limit', async () => {
      const res = await analyze({
        options: { switches: { yes: true } },
        config,
        run: fakeRun({ fail: 'b.mp3' })
      });
      expect(res.analyze.written).to.equal(1);
      expect(res.analyze.failed).to.deep.equal([
        { file: 'b.mp3', error: 'cannot decode', count: 1 }
      ]);
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

    it('should leave out a song after 3 failures until its file changes, --refresh, or it works', async () => {
      const failing = () =>
        analyze({ options: { switches: { yes: true } }, config, run: fakeRun({ fail: 'b.mp3' }) });
      const dryRun = (switches = {}) =>
        analyze({ options: { switches: { dryRun: true, ...switches } }, config, run: fakeRun() });
      expect((await failing()).analyze.failed[0].count).to.equal(1);
      expect((await failing()).analyze.failed[0].count).to.equal(2);
      expect((await failing()).analyze.failed[0]).to.include({ count: 3, error: 'cannot decode' });
      // the fourth run leaves it out and says so
      expect((await dryRun()).analyze).to.include({ songs: 0, skipped: 1 });
      expect((await dryRun({ refresh: true })).analyze).to.include({ songs: 2, skipped: 0 });
      const db = openDatabase(config.db.path);
      const failures = () => db.prepare('SELECT count, error FROM analysis_failures').all();
      expect(failures()).to.deep.equal([{ count: 3, error: 'cannot decode' }]);
      // a changed file (db --update stores its new mtime) is tried again, its count starting over
      db.prepare("UPDATE songs SET mtime = mtime + 1 WHERE path = 'b.mp3'").run();
      expect((await dryRun()).analyze).to.include({ songs: 1, skipped: 0 });
      expect((await failing()).analyze.failed[0].count).to.equal(1);
      // an analysis that works forgets the failures
      expect(
        (await analyze({ options: { switches: { yes: true } }, config, run: fakeRun() })).analyze
      ).to.include({ written: 1 });
      expect(failures()).to.deep.equal([]);
      // the table follows the songs
      db.prepare("DELETE FROM songs WHERE path = 'b.mp3'").run();
      db.close();
    });
  });
});

describe('Essentia analysis workers', () => {
  // a worker that says it is ready (or not), answers each file, and dies on the ones named crash, with
  // code 139 and SIGSEGV as Essentia's decoder does
  const workerSpawn = ({ crash = [], ready = true, dieAtStart = false } = {}) => {
    const spawned = [];
    const spawnProcess = () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let dead = false;
      const die = (code, signal) => {
        if (!dead) {
          dead = true;
          child.stdout.end();
          child.stderr.end();
          setImmediate(() => child.emit('close', code, signal));
        }
      };
      child.kill = signal => die(null, signal);
      if (ready) {
        child.stdout.write(`${JSON.stringify({ ready: true })}\n`);
      }
      if (dieAtStart) {
        setImmediate(() => die(1, null));
      }
      let buffer = '';
      child.stdin.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(line => {
          const file = line.split('\t')[0];
          if (crash.includes(file)) {
            die(null, 'SIGSEGV');
          } else if (!dead && !dieAtStart) {
            child.stdout.write(`${JSON.stringify(result(file))}\n`);
          }
        });
      });
      child.stdin.on('finish', () => die(0, null));
      spawned.push(child);
      return child;
    };
    return { spawnProcess, spawned };
  };

  it('should report the file a worker crashes on, replace the worker, and analyse the rest', async () => {
    const { spawnProcess, spawned } = workerSpawn({ crash: ['2.mp3'] });
    const results = [];
    const logs = [];
    await runAnalysis({
      files: ['1.mp3', '2.mp3', '3.mp3', '4.mp3'],
      workers: 1,
      spawnProcess,
      onResult: r => results.push(r),
      onLog: line => logs.push(line)
    }).done;
    expect(_.map(results, 'file')).to.deep.equal(['1.mp3', '2.mp3', '3.mp3', '4.mp3']);
    expect(results[1]).to.deep.equal({
      file: '2.mp3',
      error: 'the analysis worker crashed on it (SIGSEGV)',
      crashed: true
    });
    expect(spawned).to.have.length(2);
    expect(logs.join('\n')).to.include('crashed on it (SIGSEGV): 2.mp3');
    // a crash on the last file reports it and starts nothing more
    const last = workerSpawn({ crash: ['y.mp3'] });
    const lastResults = [];
    await runAnalysis({
      files: ['x.mp3', { file: 'y.mp3', parts: ['styles'] }],
      workers: 1,
      spawnProcess: last.spawnProcess,
      onResult: r => lastResults.push(r)
    }).done;
    expect(_.map(lastResults, 'file')).to.deep.equal(['x.mp3', 'y.mp3']);
    expect(last.spawned).to.have.length(1);
  });

  it('should name the signal behind the exit code of uv, and give a plain exit code as it is', async () => {
    const exiting = code => {
      const { spawnProcess } = workerSpawn();
      return () => {
        const child = spawnProcess();
        child.stdin.removeAllListeners('data');
        child.stdin.once('data', () => {
          child.stdout.end();
          setImmediate(() => child.emit('close', code, null));
        });
        return child;
      };
    };
    const errorOf = async code => {
      const results = [];
      await runAnalysis({
        files: ['1.mp3'],
        workers: 1,
        spawnProcess: exiting(code),
        onResult: r => results.push(r)
      }).done;
      return results[0].error;
    };
    expect(await errorOf(139)).to.equal(
      'the analysis worker crashed on it (SIGSEGV, exit code 139)'
    );
    expect(await errorOf(134)).to.equal(
      'the analysis worker crashed on it (SIGABRT, exit code 134)'
    );
    expect(await errorOf(2)).to.equal('the analysis worker exited with code 2 on it');
  });

  it('should blame no file for a worker that dies before it is ready, or that is stopped', async () => {
    const early = workerSpawn({ ready: false, dieAtStart: true });
    const results = [];
    await runAnalysis({
      files: ['1.mp3', '2.mp3'],
      workers: 1,
      spawnProcess: early.spawnProcess,
      onResult: r => results.push(r)
    }).done;
    expect(results).to.deep.equal([]);
    expect(early.spawned).to.have.length(1);
    // stop: the files in progress are left for next time
    const slow = workerSpawn();
    const stopped = [];
    const run = runAnalysis({
      files: ['1.mp3', '2.mp3'],
      workers: 2,
      spawnProcess: () => {
        const child = slow.spawnProcess();
        child.stdin.removeAllListeners('data');
        return child;
      },
      onResult: r => stopped.push(r)
    });
    run.stop();
    await run.done;
    expect(stopped).to.deep.equal([]);
  });
});
