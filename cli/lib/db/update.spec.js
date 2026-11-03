const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('./database.js');
const { syncTagDefinitions } = require('./tags.js');
const { frameRows, updateDatabase } = require('./update.js');

const sourceDir = path.join(process.cwd(), 'test/data/source');

describe('Database Update', () => {
  let db;
  let library;
  const config = () => ({
    mpd: { baseDirectory: library },
    rating: { tag: 'POPM', max: 5 },
    library: {
      tags: [
        { id: 'TPE1', name: 'artist' },
        { id: 'TIT2', name: 'title' }
      ]
    },
    tags: [{ id: 'TXXX.Mood', name: 'mood', multi: true }]
  });
  const update = (target = library, options = {}) =>
    updateDatabase(db, { config: config(), target, ...options });
  const song = file => db.prepare('SELECT * FROM songs WHERE path = ?').get(file);
  const songTags = file =>
    db
      .prepare(
        'SELECT frame_id, value FROM song_tags JOIN songs ON songs.id = song_id WHERE path = ? ORDER BY frame_id, value'
      )
      .all(file)
      .map(({ frame_id: frameId, value }) => [frameId, value]);
  // change mtime so the next update reads the file again
  const touch = file =>
    fs.utimesSync(path.join(library, file), new Date(), new Date(Date.now() + 5000));

  beforeEach(() => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-library-'));
    fs.cpSync(sourceDir, library, { recursive: true });
    db = openDatabase(':memory:');
    syncTagDefinitions(db, config());
  });

  afterEach(() => {
    db.close();
    fs.rmSync(library, { recursive: true, force: true });
  });

  describe('frameRows', () => {
    const multiFrames = new Set(['TXXX.Mood', 'TCON']);

    it('should create a row per populated frame and skip blank values', () => {
      expect(
        frameRows({ TPE1: 'Artist', TIT2: ' ', duration: 10, size: 20 }, multiFrames)
      ).to.deep.equal([['TPE1', 'Artist']]);
    });

    it('should identify custom fields by description and split multi value fields', () => {
      const TXXX = [
        { description: 'Mood', value: 'Happy, Sad,,Happy' },
        { description: 'Context', value: 'Work, Study' }
      ];
      expect(frameRows({ TXXX, TCON: 'Rock,Pop' }, multiFrames)).to.deep.equal([
        ['TXXX.Mood', 'Happy'],
        ['TXXX.Mood', 'Sad'],
        ['TXXX.Context', 'Work, Study'],
        ['TCON', 'Rock'],
        ['TCON', 'Pop']
      ]);
    });

    it('should store structured frames as JSON and cover art as a marker', () => {
      expect(
        frameRows(
          { POPM: { rating: 255 }, APIC: true, COMM: [{ text: 'a' }, { text: 'b' }] },
          multiFrames
        )
      ).to.deep.equal([
        ['POPM', '{"rating":255}'],
        ['APIC', '1'],
        ['COMM', '{"text":"a"}'],
        ['COMM', '{"text":"b"}']
      ]);
    });
  });

  describe('updateDatabase', () => {
    it('should add every mp3 file with tags, rating, duration, and size', async () => {
      const summary = await update();
      expect(summary).to.include({ scanned: 16, added: 16, unchanged: 0, failed: 0, target: '.' });

      const row = song('dir1/testFile01.mp3');
      expect(row.rating).to.equal(5);
      expect(row.size).to.equal(fs.statSync(path.join(library, 'dir1/testFile01.mp3')).size);
      expect(row.duration).to.be.greaterThan(0);
      expect(songTags('dir1/testFile01.mp3')).to.deep.include(['TPE1', 'Artist J']);
      expect(songTags('dir1/testFile01.mp3')).to.deep.include(['TXXX.Mood', 'Sad']);
      expect(songTags('dir1/testFile01.mp3')).to.deep.include(['TXXX.Mood', 'Gloomy']);
    });

    it('should skip files with unchanged mtime and size', async () => {
      await update();
      const summary = await update();
      expect(summary).to.include({ scanned: 16, unchanged: 16, added: 0, updated: 0 });
    });

    it('should update changed files and replace their tags', async () => {
      await update();
      const file = path.join(library, 'dir1/testFile01.mp3');
      NodeId3.update({ artist: 'New Artist' }, file);
      touch('dir1/testFile01.mp3');

      const summary = await update();
      expect(summary).to.include({ updated: 1, unchanged: 15 });
      expect(songTags('dir1/testFile01.mp3')).to.deep.include(['TPE1', 'New Artist']);
      expect(songTags('dir1/testFile01.mp3')).to.not.deep.include(['TPE1', 'Artist J']);
    });

    it('should stamp rated_at when the rating changes, and only then', async () => {
      await update();
      const file = 'dir1/testFile01.mp3';
      expect(song(file).rated_at).to.be.null;
      NodeId3.update({ artist: 'Another Artist' }, path.join(library, file));
      touch(file);
      await update();
      expect(song(file).rated_at).to.be.null;
      NodeId3.update(
        { popularimeter: { email: 'musicman', rating: 196, counter: 0 } },
        path.join(library, file)
      );
      touch(file);
      await update();
      const stamped = song(file).rated_at;
      expect(stamped).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // another tag write leaves the rating time alone
      db.prepare('UPDATE songs SET rated_at = ? WHERE path = ?').run('2026-01-01 00:00:00', file);
      NodeId3.update({ artist: 'Third Artist' }, path.join(library, file));
      touch(file);
      await update();
      expect(song(file).rated_at).to.equal('2026-01-01 00:00:00');
    });

    it('should re-link a moved file by MusicBrainz track id and keep its song id', async () => {
      const file = path.join(library, 'dir1/testFile02.mp3');
      NodeId3.update(
        { userDefinedText: [{ description: 'MusicBrainz Release Track Id', value: 'mb-1' }] },
        file
      );
      await update();
      const { id, added_at: addedAt } = song('dir1/testFile02.mp3');

      fs.renameSync(file, path.join(library, 'moved.mp3'));
      const summary = await update();
      expect(summary).to.include({ moved: 1, added: 0, removed: 0 });
      expect(song('dir1/testFile02.mp3')).to.be.undefined;
      expect(song('moved.mp3')).to.include({ id, mb_track_id: 'mb-1', added_at: addedAt });
    });

    it('should re-link a moved file without a MusicBrainz id by its Spotify track id', async () => {
      const file = path.join(library, 'dir1/testFile02.mp3');
      NodeId3.update(
        { userDefinedText: [{ description: 'sp_track_id', value: '4uLU6hMCjMI75M1A2tKUQC' }] },
        file
      );
      await update();
      const { id } = song('dir1/testFile02.mp3');
      fs.renameSync(file, path.join(library, 'moved.mp3'));
      const summary = await update();
      expect(summary).to.include({ moved: 1, added: 0, removed: 0 });
      expect(song('moved.mp3')).to.include({ id });
    });

    it('should re-link a moved file without ids by artist, title and length, one song only', async () => {
      await update();
      const { id } = song('dir1/testFile03.mp3');
      fs.renameSync(path.join(library, 'dir1/testFile03.mp3'), path.join(library, 'moved.mp3'));
      expect(await update()).to.include({ moved: 1, added: 0, removed: 0 });
      expect(song('moved.mp3')).to.include({ id });

      // two copies of one song moved at once: which is which cannot be told, so neither is followed
      fs.copyFileSync(path.join(library, 'moved.mp3'), path.join(library, 'copy.mp3'));
      await update();
      fs.renameSync(path.join(library, 'moved.mp3'), path.join(library, 'moved2.mp3'));
      fs.renameSync(path.join(library, 'copy.mp3'), path.join(library, 'copy2.mp3'));
      expect(await update()).to.include({ moved: 0, added: 2, removed: 2 });
    });

    it('should point the undo history of a moved file at its new path', async () => {
      const file = path.join(library, 'dir1/testFile02.mp3');
      const moved = path.join(library, 'moved.mp3');
      NodeId3.update(
        { userDefinedText: [{ description: 'MusicBrainz Release Track Id', value: 'mb-1' }] },
        file
      );
      await update();
      const { id } = song('dir1/testFile02.mp3');
      db.prepare(
        `INSERT INTO history_runs (id, command, args, started_at) VALUES ('run-1', 'edit', '[]', 'now')`
      ).run();
      db.prepare(
        `INSERT INTO tag_changes (run_id, path, frame, before, after_hash) VALUES ('run-1', ?, 'TIT2', '"a"', 'h')`
      ).run(file);
      db.prepare(
        `INSERT INTO match_changes (run_id, song_id, path, before, after_hash) VALUES ('run-1', ?, ?, 'null', 'h')`
      ).run(id, 'dir1/testFile02.mp3');

      fs.renameSync(file, moved);
      await update();
      expect(db.prepare('SELECT path FROM tag_changes').all()).to.deep.equal([{ path: moved }]);
      expect(db.prepare('SELECT path FROM match_changes').all()).to.deep.equal([
        { path: 'moved.mp3' }
      ]);
    });

    it('should remove songs whose files are gone', async () => {
      await update();
      fs.unlinkSync(path.join(library, 'dir1/testFile03.mp3'));
      const removedFiles = [];
      const summary = await update(library, {
        onFile: (action, file) => action === 'removed' && removedFiles.push(file)
      });
      expect(summary).to.include({ removed: 1, scanned: 15 });
      expect(removedFiles).to.deep.equal(['dir1/testFile03.mp3']);
      expect(song('dir1/testFile03.mp3')).to.be.undefined;
    });

    it('should only scan and remove within a target directory', async () => {
      await update();
      fs.unlinkSync(path.join(library, 'dir1/testFile03.mp3'));
      fs.unlinkSync(path.join(library, '1-second-of-silence.mp3'));

      const summary = await update(path.join(library, 'dir1'));
      expect(summary).to.include({ target: 'dir1', scanned: 5, removed: 1 });
      expect(song('1-second-of-silence.mp3')).to.not.be.undefined;
    });

    it('should count files that cannot be read as failed and keep going', async () => {
      fs.writeFileSync(path.join(library, 'broken.mp3'), '');
      fs.chmodSync(path.join(library, 'broken.mp3'), 0o000);
      const failures = [];
      const summary = await update(library, {
        onFile: (action, file) => action === 'failed' && failures.push(file)
      });
      expect(summary).to.include({ failed: 1, added: 16 });
      expect(failures).to.deep.equal(['broken.mp3']);
    });

    it('should report progress for every file read', async () => {
      const progress = [];
      await update(library, { onProgress: ({ done, total }) => progress.push([done, total]) });
      expect(progress).to.have.length(16);
      expect(progress[15]).to.deep.equal([16, 16]);
    });

    it('should reject a target outside mpd.baseDirectory', async () => {
      try {
        await update(os.tmpdir());
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.include('is not inside mpd.baseDirectory');
      }
    });

    it('should record the last update summary', async () => {
      await update();
      const { value } = db.prepare("SELECT value FROM meta WHERE key = 'lastUpdate'").get();
      expect(JSON.parse(value)).to.include({ added: 16, target: '.' });
    });
  });
});
