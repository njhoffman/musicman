const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { openDatabase } = require('./database.js');
const { readStoredMetadata, toRawTags } = require('./read.js');

describe('Database Read', () => {
  describe('toRawTags', () => {
    const song = { duration: 12.5, size: 1000 };

    it('should rebuild text frames and join multi value rows with commas', () => {
      const rows = [
        { frame_id: 'TPE1', value: 'Artist' },
        { frame_id: 'TCON', value: 'Rock' },
        { frame_id: 'TCON', value: 'Pop' }
      ];
      expect(toRawTags(song, rows)).to.deep.equal({
        TPE1: 'Artist',
        TCON: 'Rock,Pop',
        duration: 12.5,
        size: 1000
      });
    });

    it('should rebuild custom fields as TXXX entries', () => {
      const rows = [
        { frame_id: 'TXXX.Mood', value: 'Happy' },
        { frame_id: 'TXXX.Mood', value: 'Sad' },
        { frame_id: 'TXXX.Picks', value: 'Best' }
      ];
      expect(toRawTags(song, rows).TXXX).to.deep.equal([
        { description: 'Mood', value: 'Happy,Sad' },
        { description: 'Picks', value: 'Best' }
      ]);
    });

    it('should parse structured frames and restore the cover art marker', () => {
      const rows = [
        { frame_id: 'POPM', value: '{"rating":255}' },
        { frame_id: 'APIC', value: '1' },
        { frame_id: 'COMM', value: '{"text":"a"}' },
        { frame_id: 'COMM', value: '{"text":"b"}' }
      ];
      expect(toRawTags({ duration: null, size: 5 }, rows)).to.deep.equal({
        POPM: { rating: 255 },
        APIC: true,
        COMM: [{ text: 'a' }, { text: 'b' }],
        size: 5
      });
    });
  });

  describe('readStoredMetadata', () => {
    let db;
    let library;

    beforeEach(() => {
      library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-read-'));
      db = openDatabase(':memory:');
      ['a.mp3', 'b.mp3', 'c.mp3'].forEach(file => fs.writeFileSync(path.join(library, file), file));
      const insert = db.prepare(
        'INSERT INTO songs (path, mtime, size, duration) VALUES (?, ?, ?, ?)'
      );
      ['a.mp3', 'b.mp3'].forEach(file => {
        const stat = fs.statSync(path.join(library, file));
        const { lastInsertRowid } = insert.run(file, Math.floor(stat.mtimeMs), stat.size, 1);
        db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)').run(
          lastInsertRowid,
          'TIT2',
          file
        );
      });
    });

    afterEach(() => {
      db.close();
      fs.rmSync(library, { recursive: true, force: true });
    });

    it('should return stored tags for unchanged files and stale files separately', () => {
      fs.writeFileSync(path.join(library, 'b.mp3'), 'changed size');
      const files = ['a.mp3', 'b.mp3', 'c.mp3'].map(file => path.join(library, file));
      const { stored, stale } = readStoredMetadata(db, {
        config: { mpd: { baseDirectory: library } },
        files
      });
      expect(stored).to.deep.equal([[files[0], { TIT2: 'a.mp3', duration: 1, size: 5 }]]);
      expect(stale).to.deep.equal([files[1], files[2]]);
    });
  });
});
