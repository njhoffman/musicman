const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const yaml = require('js-yaml');
const {
  importConfigArgs,
  importDownloads,
  importedMoves,
  importTags,
  parseBeetsLog,
  recoverImports,
  staleDownloads
} = require('./import.js');

describe('Download Import', () => {
  const idA = 'AAAAAAAAAAAAAAAAAAAAAA';
  const idB = 'BBBBBBBBBBBBBBBBBBBBBB';
  let directory;
  let library;
  let config;
  let manifest;
  const download = (id, name) => path.join(directory, `${name} [${id}].mp3`);
  const custom = file =>
    Object.fromEntries((NodeId3.read(file).raw.TXXX || []).map(t => [t.description, t.value]));

  // fake beets: moves each imported file into the library and logs the second one as imported as is
  const fakeBeet = calls => async args => {
    calls.push(args);
    const files = args.slice(args.indexOf('-l') + 2);
    const log = args[args.indexOf('-l') + 1];
    fs.writeFileSync(log, `import started\nasis ${files[1] || ''}\n`);
    files.forEach(file => fs.renameSync(file, path.join(library, path.basename(file))));
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-import-'));
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-import-lib-'));
    const source = path.join(process.cwd(), 'test/data/source/dir1');
    const [first, second] = fs.readdirSync(source).filter(name => name.endsWith('.mp3'));
    fs.copyFileSync(path.join(source, first), download(idA, 'A - One'));
    fs.copyFileSync(path.join(source, second), download(idB, 'B - Two'));
    NodeId3.update({ TSRC: 'EXISTING' }, download(idA, 'A - One'));
    fs.writeFileSync(path.join(directory, 'notes.mp3'), '');
    config = {
      sync: { downloadDirectory: directory, beetsConfig: '/beets/config.yaml' },
      tags: [
        { id: 'TIT1', name: 'grouping' },
        { id: 'TXXX.Context', name: 'context', multi: true },
        { id: 'TSRC', name: 'isrc_code' }
      ],
      spotify: {
        fields: [
          { path: 'track.popularity', name: 'sp_popularity' },
          { path: 'track.external_ids.isrc', name: 'sp_isrc', fallback: 'isrc_code' }
        ],
        ignore: ['album', 'artists', 'name']
      }
    };
    manifest = {
      tracks: [
        {
          trackId: idA,
          artists: 'A',
          name: 'One',
          tags: { grouping: 'IndieRock.Artists', context: ['Study', 'Run'] }
        },
        { trackId: idB, artists: 'B', name: 'Two', tags: {} }
      ]
    };
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(library, { recursive: true, force: true });
  });

  const files = () =>
    fs
      .readdirSync(directory)
      .filter(name => name.endsWith('.mp3'))
      .sort()
      .map(name => path.join(directory, name));
  const client = objects => ({
    get: async url => {
      const [, type, ids] = url.match(/^\/(\w+)\?ids=(.*)$/);
      return { [type]: ids.split(',').map(id => objects[id] || null) };
    }
  });
  const tracks = {
    [idA]: { id: idA, popularity: 50, external_ids: { isrc: 'NEW' } },
    [idB]: { id: idB, popularity: 7, external_ids: { isrc: 'ISRCB' } }
  };

  it('should tag downloads with Spotify fields and playlist tags, then import them with beets', async () => {
    const calls = [];
    const events = [];
    const now = new Date('2026-10-21T10:00:00Z');
    const beetsLog = path.join(directory, 'beets-import.log');
    const [fileA, fileB] = [download(idA, 'A - One'), download(idB, 'B - Two')];
    const summary = await importDownloads({
      config,
      client: client(tracks),
      manifest,
      files: files(),
      beetsLog,
      now,
      runBeet: async args => {
        // tags are written before beets runs
        expect(custom(fileA)).to.include({
          sp_track_id: idA,
          sp_popularity: '50',
          Context: 'Study,Run'
        });
        // the grouping waits as a hint, so beets files the unrated download as a single
        expect(NodeId3.read(fileA).raw.TIT1).to.equal(undefined);
        expect(custom(fileA)).to.include({ playlist_grouping: 'IndieRock.Artists' });
        expect(NodeId3.read(fileA).raw.TSRC).to.equal('EXISTING');
        expect(NodeId3.read(fileB).raw.TSRC).to.equal('ISRCB');
        return fakeBeet(calls)(args);
      },
      onFile: status => events.push(status)
    });
    expect(calls[0].slice(0, 8)).to.deep.equal([
      '-c',
      '/beets/config.yaml',
      'import',
      '-s',
      '-q',
      '-A',
      '-l',
      beetsLog
    ]);
    expect(calls[0].slice(8)).to.deep.equal([fileA, fileB]);
    expect(summary).to.include({ tagged: 2, imported: 2, detailsError: null });
    expect(summary.unknown).to.deep.equal([path.join(directory, 'notes.mp3')]);
    expect(_.map(manifest.tracks, 'importedAt')).to.deep.equal([
      now.toISOString(),
      now.toISOString()
    ]);
    expect(events).to.deep.equal(['unknown', 'tagged', 'tagged']);
    expect(summary.files[0].playlist).to.include('playlist_grouping:IndieRock.Artists');
  });

  // the file's audio behind a tag of only spotDL's popularity POPM (no email, rating 25), as mutagen
  // writes it: v2.3 header, frame id, size, flags, then an empty email and the rating
  const withPopularity = file => {
    NodeId3.removeTags(file);
    const body = Buffer.from([0, 25]);
    const frame = Buffer.concat([
      Buffer.from('POPM'),
      Buffer.from([0, 0, 0, body.length, 0, 0]),
      body
    ]);
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, frame.length]);
    fs.writeFileSync(file, Buffer.concat([header, frame, fs.readFileSync(file)]));
  };

  it("should remove spotDL's popularity POPM unless a rating playlist sets one", async () => {
    const [fileA, fileB] = [download(idA, 'A - One'), download(idB, 'B - Two')];
    withPopularity(fileA);
    withPopularity(fileB);
    expect(NodeId3.read(fileB).raw.POPM).to.include({ rating: 25, email: undefined });
    manifest.tracks[0].tags.rating = '5.0';
    const summary = await importDownloads({
      config: { ...config, rating: { tag: 'POPM', max: 5, email: 'Default' } },
      client: client(tracks),
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      runBeet: fakeBeet([])
    });
    expect(_.map(summary.files, 'popularity')).to.deep.equal([false, true]);
    const imported = name => path.join(library, path.basename(name));
    expect(NodeId3.read(imported(fileA)).raw.POPM).to.include({ email: 'Default', rating: 255 });
    expect(NodeId3.read(imported(fileB)).raw.POPM).to.equal(undefined);
    expect(custom(imported(fileB))).to.include({ sp_popularity: '7' });
  });

  it('should report the details, tagging, and beets phases', async () => {
    const progress = [];
    let gone = 0;
    await importDownloads({
      config,
      client: client(tracks),
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      pollMs: 1,
      // the first download leaves the folder before beets finishes
      runBeet: async args => {
        const [first] = args.slice(args.indexOf('-l') + 2);
        fs.renameSync(first, path.join(library, path.basename(first)));
        gone = 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return fakeBeet([])(args.filter(arg => arg !== first));
      },
      onProgress: (phase, done, total) => progress.push([phase, done, total])
    });
    expect(gone).to.equal(1);
    expect(progress.slice(0, 4)).to.deep.equal([
      ['details', 0, 2],
      ['tagging', 1, 2],
      ['tagging', 2, 2],
      ['beets', 0, 2]
    ]);
    expect(progress).to.deep.include(['beets', 1, 2]);
    expect(_.last(progress)).to.deep.equal(['beets', 2, 2]);
    // no counts after beets finished
    const count = progress.length;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(progress).to.have.length(count);
  });

  it('should write ids and playlist tags without track details and skip imported tracks', async () => {
    manifest.tracks[1].importedAt = '2026-10-20T00:00:00.000Z';
    const limited = {
      get: async () => {
        throw new Error('rate limited');
      }
    };
    const calls = [];
    const summary = await importDownloads({
      config,
      client: limited,
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      runBeet: fakeBeet(calls)
    });
    expect(summary).to.include({ tagged: 1, detailsError: 'rate limited' });
    expect(calls[0].slice(8)).to.deep.equal([download(idA, 'A - One')]);
    const moved = path.join(library, path.basename(download(idA, 'A - One')));
    expect(custom(moved)).to.include({ sp_track_id: idA, Context: 'Study,Run' });
    expect(custom(moved)).to.not.have.property('sp_popularity');
  });

  it('should write the rating of a rating playlist like edit does', async () => {
    config.rating = { tag: 'POPM', email: 'Default', max: 5 };
    manifest.tracks[0].tags = { rating: '4.5' };
    manifest.tracks[1].importedAt = '2026-10-20T00:00:00.000Z';
    const summary = await importDownloads({
      config,
      client: { get: async () => ({}) },
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      runBeet: fakeBeet([])
    });
    const moved = path.join(library, path.basename(download(idA, 'A - One')));
    const popm = [].concat(NodeId3.read(moved).raw.POPM)[0];
    expect(popm).to.include({ email: 'Default', rating: 230 });
    expect(summary.files[0].playlist).to.deep.equal(['rating:4.5']);
  });

  it('should not write or run beets in a dry run', async () => {
    const before = fs.readFileSync(download(idA, 'A - One'));
    const runBeet = sinon.spy();
    const summary = await importDownloads({
      config,
      client: client(tracks),
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      dryRun: true,
      runBeet
    });
    expect(summary).to.include({ tagged: 2, imported: 0, dryRun: true });
    expect(runBeet).to.not.have.been.called;
    expect(fs.readFileSync(download(idA, 'A - One')).equals(before)).to.be.true;
    expect(manifest.tracks[0]).to.not.have.property('importedAt');
  });

  it('should tag downloads as singles, without album fields or album fallbacks', () => {
    const tags = importTags({
      raw: {},
      entry: { trackId: idA, tags: {} },
      objects: { track: { id: idA, name: 'One', album: { name: 'Hits', total_tracks: 18 } } },
      config: {
        tags: [{ id: 'TALB', name: 'album' }],
        spotify: {
          fields: [
            { path: 'track.name', name: 'sp_title' },
            {
              path: 'track.album.name',
              name: 'sp_album',
              fallback: 'album',
              fallbackScope: 'album'
            },
            { path: 'track.album.total_tracks', name: 'sp_total_tracks', scope: 'album' }
          ]
        }
      },
      now: new Date('2026-10-21T10:00:00Z')
    });
    expect(_.map(tags.custom, 'name')).to.deep.equal([
      'sp_track_id',
      'sp_fetched_at',
      'sp_title',
      'sp_album'
    ]);
    expect(tags.filled).to.deep.equal([]);
  });

  it('should parse the files beets imported as is or skipped from its log', () => {
    expect(parseBeetsLog('import started\nasis /a.mp3\nskip /b.mp3; /c.mp3\n')).to.deep.equal({
      asis: [{ action: 'asis', file: '/a.mp3' }],
      skip: [{ action: 'skip', file: '/b.mp3' }]
    });
  });

  describe('importedMoves', () => {
    let db;
    const addSong = (songPath, trackId) => {
      const id = Number(
        db.prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 0, 0)').run(songPath)
          .lastInsertRowid
      );
      db.prepare(
        `INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', ?)`
      ).run(id, trackId);
    };
    const moves = (files, added, exists = () => false) =>
      importedMoves({ db, baseDirectory: '/music', files, added, exists });

    beforeEach(() => {
      db = openDatabase(':memory:');
    });

    afterEach(() => db.close());

    it('should pair a moved download with the added song carrying its track id', () => {
      addSong('Unrated/_Singles/A.mp3', idA);
      expect(
        moves([{ file: '/dl/A [a].mp3', trackId: idA }], ['Unrated/_Singles/A.mp3'])
      ).to.deep.equal([{ from: '/dl/A [a].mp3', to: '/music/Unrated/_Singles/A.mp3' }]);
    });

    it('should skip downloads still in place, without an id, or matching no added song', () => {
      addSong('Unrated/_Singles/A.mp3', idA);
      addSong('Rated/B.mp3', idB);
      const added = ['Unrated/_Singles/A.mp3'];
      expect(moves([{ file: '/dl/A.mp3', trackId: idA }], added, () => true)).to.deep.equal([]);
      expect(moves([{ file: '/dl/X.mp3', trackId: null }], added)).to.deep.equal([]);
      // B is in the library already but was not added by this import
      expect(moves([{ file: '/dl/B.mp3', trackId: idB }], added)).to.deep.equal([]);
    });

    it('should skip a track id that several added songs carry', () => {
      addSong('Unrated/_Singles/A.mp3', idA);
      addSong('Unrated/_Singles/A.1.mp3', idA);
      expect(
        moves(
          [{ file: '/dl/A.mp3', trackId: idA }],
          ['Unrated/_Singles/A.mp3', 'Unrated/_Singles/A.1.mp3']
        )
      ).to.deep.equal([]);
    });
  });

  describe('importConfigArgs', () => {
    it('should pass the beets config unless lyrics are left out', () => {
      expect(importConfigArgs(config)).to.deep.equal(['-c', '/beets/config.yaml']);
      expect(importConfigArgs({ sync: { downloadDirectory: directory } })).to.deep.equal([]);
    });

    it('should write a copy of the beets config with lyrics.auto off', () => {
      const beetsConfig = path.join(directory, 'config.yaml');
      fs.writeFileSync(
        beetsConfig,
        'import:\n  move: true\nlyrics:\n  auto: true\n  force: false\n'
      );
      const args = importConfigArgs({
        sync: { downloadDirectory: directory, beetsConfig, importLyrics: false }
      });
      expect(args).to.deep.equal(['-c', path.join(directory, 'beets-import.yaml')]);
      expect(yaml.load(fs.readFileSync(args[1], 'utf8'))).to.deep.equal({
        import: { move: true },
        lyrics: { auto: false, force: false }
      });
    });
  });

  describe('recoverImports', () => {
    let db;
    const runId = 'run-1';
    const record = file =>
      db
        .prepare(
          `INSERT INTO tag_changes (run_id, path, frame, before, after_hash) VALUES (?, ?, 'TIT2', NULL, 'h')`
        )
        .run(runId, file);
    const addSong = (songPath, trackId) => {
      const id = Number(
        db.prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 0, 0)').run(songPath)
          .lastInsertRowid
      );
      db.prepare(
        `INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TXXX.sp_track_id', ?)`
      ).run(id, trackId);
    };

    beforeEach(() => {
      db = openDatabase(':memory:');
      db.prepare(
        `INSERT INTO history_runs (id, command, args, started_at) VALUES (?, 'sync', '[]', 'now')`
      ).run(runId);
      config.mpd = { baseDirectory: library };
    });

    afterEach(() => db.close());

    it('should list history paths in the download folder whose files are gone', () => {
      const present = download(idA, 'A - One');
      const gone = path.join(directory, 'C - Three [CCCCCCCCCCCCCCCCCCCCCC].mp3');
      record(present);
      record(gone);
      record(path.join(library, 'elsewhere.mp3'));
      expect(staleDownloads(db, config)).to.deep.equal([gone]);
    });

    it('should mark moved downloads imported and point their history at the library song', () => {
      const idC = 'CCCCCCCCCCCCCCCCCCCCCC';
      const gone = path.join(directory, `C - Three [${idC}].mp3`);
      manifest.tracks.push({ trackId: idC, artists: 'C', name: 'Three', tags: {} });
      record(gone);
      addSong('Unrated/_Singles/C - Three.mp3', idC);
      const now = new Date('2026-11-02T12:00:00Z');
      const recovered = recoverImports({ db, config, manifest, stale: [gone], now });
      const to = path.join(library, 'Unrated/_Singles/C - Three.mp3');
      expect(recovered).to.deep.equal([{ trackId: idC, from: gone, to }]);
      expect(_.find(manifest.tracks, { trackId: idC }).importedAt).to.equal(now.toISOString());
      expect(db.prepare('SELECT path FROM tag_changes').all()).to.deep.equal([{ path: to }]);
    });

    it('should leave tracks downloaded again, or with no or several songs', () => {
      const idC = 'CCCCCCCCCCCCCCCCCCCCCC';
      const idD = 'DDDDDDDDDDDDDDDDDDDDDD';
      // idA is in the download folder again
      addSong('Unrated/_Singles/A.mp3', idA);
      addSong('Unrated/_Singles/D.mp3', idD);
      addSong('Rated/D.mp3', idD);
      const stale = [
        path.join(directory, `A - One old [${idA}].mp3`),
        path.join(directory, `C [${idC}].mp3`),
        path.join(directory, `D [${idD}].mp3`)
      ];
      expect(recoverImports({ db, config, manifest, stale })).to.deep.equal([]);
      expect(_.map(manifest.tracks, 'importedAt')).to.deep.equal([undefined, undefined]);
    });
  });
});
