const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const {
  featureFields,
  featureWrites,
  fetchFeatures,
  keyName,
  songsForFeatures
} = require('./features.js');

const idA = 'AAAAAAAAAAAAAAAAAAAAAA';
const idB = 'BBBBBBBBBBBBBBBBBBBBBB';
const item = (id, extra = {}) => ({
  id: 'uuid',
  href: `https://open.spotify.com/track/${id}`,
  acousticness: 0.22,
  danceability: 0.585,
  energy: 0.764,
  instrumentalness: 0.00173,
  key: 1,
  liveness: 0.722,
  loudness: -3.965,
  mode: 1,
  speechiness: 0.101,
  tempo: 164.786,
  valence: 0.469,
  ...extra
});

describe('Audio features (ReccoBeats)', () => {
  it('should name keys in standard notation, minor with m, and none when not detected', () => {
    expect(keyName(1, 1)).to.equal('C#');
    expect(keyName(9, 0)).to.equal('Am');
    expect(keyName(-1, 1)).to.equal(null);
    expect(keyName(undefined, 1)).to.equal(null);
  });

  it('should write tempo to TBPM, key to TKEY, and the rest to rb_ fields with two decimals', () => {
    const writes = featureWrites(item(idA), featureFields, new Date('2026-11-03T10:00:00Z'));
    expect(writes.standard).to.deep.equal({ TBPM: '165', TKEY: 'C#' });
    expect(writes.custom).to.deep.equal([
      { name: 'rb_acousticness', value: '0.22' },
      { name: 'rb_danceability', value: '0.58' },
      { name: 'rb_energy', value: '0.76' },
      { name: 'rb_instrumentalness', value: '0.00' },
      { name: 'rb_liveness', value: '0.72' },
      { name: 'rb_loudness', value: '-3.96' },
      { name: 'rb_speechiness', value: '0.10' },
      { name: 'rb_valence', value: '0.47' },
      { name: 'rb_fetched_at', value: '2026-11-03' }
    ]);
    // only the fields asked for, and nothing for a missing value
    const some = featureWrites(item(idA, { energy: null, key: -1 }), ['energy', 'key', 'tempo']);
    expect(some.standard).to.deep.equal({ TBPM: '165' });
    expect(some.custom.map(({ name }) => name)).to.deep.equal(['rb_fetched_at']);
  });

  it('should ask for 40 ids per request and key the results by Spotify track id', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `${i}`.padStart(22, 'X'));
    const urls = [];
    const fetchImpl = async url => {
      urls.push(url);
      const asked = new URL(url).searchParams.get('ids').split(',');
      // ReccoBeats knows every id but the first
      return {
        ok: true,
        json: async () => ({ content: asked.filter(id => id !== ids[0]).map(id => item(id)) })
      };
    };
    const found = await fetchFeatures(ids, { fetchImpl, pause: 0 });
    expect(urls).to.have.length(2);
    expect(new URL(urls[0]).searchParams.get('ids').split(',')).to.have.length(40);
    expect(found.size).to.equal(44);
    expect(found.has(ids[0])).to.equal(false);
    expect(found.get(ids[1])).to.include({ energy: 0.764 });
    const failing = async () => ({ ok: false, status: 503 });
    await fetchFeatures([idA], { fetchImpl: failing }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.equal('ReccoBeats audio-features failed (503)')
    );
  });

  it('should pick the songs with a Spotify id and no features yet, skipping ids it missed before', () => {
    const db = openDatabase(':memory:');
    const song = (id, songPath, tags) => {
      db.prepare('INSERT INTO songs (id, path, mtime, size) VALUES (?, ?, 0, 0)').run(id, songPath);
      tags.forEach(([frame, value]) =>
        db
          .prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)')
          .run(id, frame, value)
      );
    };
    song(1, 'a.mp3', [['TXXX.sp_track_id', idA]]);
    song(2, 'b.mp3', [
      ['TXXX.sp_track_id', idB],
      ['TXXX.rb_fetched_at', '2026-11-01']
    ]);
    song(3, 'c.mp3', []);
    song(4, 'd.mp3', [['TXXX.sp_track_id', 'CCCCCCCCCCCCCCCCCCCCCC']]);
    const missing = new Set(['CCCCCCCCCCCCCCCCCCCCCC']);
    expect(songsForFeatures(db, { missing })).to.deep.equal([{ path: 'a.mp3', trackId: idA }]);
    expect(songsForFeatures(db, { refresh: true, missing }).map(({ path: p }) => p)).to.deep.equal([
      'a.mp3',
      'b.mp3',
      'd.mp3'
    ]);
    db.close();
  });

  describe('sync --features', () => {
    const { func: syncFunc } = require('../commands/sync.js');
    let root;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-features-'));
    });

    afterEach(() => {
      process.exitCode = undefined;
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('should write the features to the files and the database, after asking', async () => {
      const library = path.join(root, 'music');
      fs.mkdirSync(library);
      const file = path.join(library, 'a.mp3');
      fs.copyFileSync(path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'), file);
      NodeId3.update({ userDefinedText: [{ description: 'sp_track_id', value: idA }] }, file);
      const config = {
        mpd: { baseDirectory: library },
        db: { path: path.join(root, 'musicman.sqlite'), backupDirectory: path.join(root, 'b') },
        library: {
          tags: [
            { name: 'sp_track_id', id: 'TXXX.sp_track_id' },
            { name: 'rb_fetched_at', id: 'TXXX.rb_fetched_at' },
            { name: 'rb_energy', id: 'TXXX.rb_energy' },
            { name: 'bpm', id: 'TBPM' },
            { name: 'key', id: 'TKEY' }
          ]
        },
        tags: [],
        features: { fields: ['energy', 'tempo', 'key'] }
      };
      const db = require('../db/index.js').openLibrary(config);
      await require('../db/update.js').updateDatabase(db, { config, target: library });
      db.close();
      const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ content: [item(idA)] })
      });
      const env = {
        SPOTIFY_CLIENT_ID: 'id',
        SPOTIFY_CLIENT_SECRET: 'secret',
        SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:6659/callback'
      };
      const run = (switches, confirm) =>
        syncFunc({
          options: { switches: { features: true, ...switches } },
          config,
          env,
          file: path.join(root, 'token.json'),
          fetchImpl,
          confirm
        });
      const told = await run({}, async () => false);
      expect(told.features).to.include({ songs: 1, found: 1, written: 0 });
      expect(NodeId3.read(file).raw.TBPM).to.equal(undefined);
      const done = await run({ yes: true });
      expect(done.features).to.include({ written: 1 });
      const raw = NodeId3.read(file).raw;
      expect(raw).to.include({ TBPM: '165', TKEY: 'C#' });
      const custom = Object.fromEntries([].concat(raw.TXXX).map(t => [t.description, t.value]));
      expect(custom).to.include({ rb_energy: '0.76' });
      const check = openDatabase(config.db.path);
      const stored = check
        .prepare("SELECT value FROM song_tags WHERE frame_id = 'TXXX.rb_energy'")
        .get();
      expect(stored.value).to.equal('0.76');
      // fetched: nothing left to look up
      expect((await run({ yes: true })).features).to.include({ songs: 0 });
      check.close();
    });
  });
});
