const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { syncTagDefinitions } = require('../db/tags.js');
const { updateDatabase } = require('../db/update.js');
const { matchSongs, reviewItems } = require('./match.js');

describe('Spotify Id Matching', () => {
  let db;
  let library;
  let config;
  const file = name => path.join(library, name);
  const songs = names => names.map(name => ({ file: file(name), meta: {}, targets: ['liked'] }));
  const spotifyId = name =>
    (NodeId3.read(file(name)).raw.TXXX || [])
      .filter(t => t.description === 'spotify_track_id')
      .map(t => t.value)[0];
  const track = (id, name, artist, seconds) => ({
    id,
    name,
    artists: [{ name: artist }],
    album: { name: 'Album' },
    duration_ms: seconds * 1000
  });

  // fake Web API client answering searches from a table of query -> tracks
  const fakeClient = answers => {
    const queries = [];
    return {
      queries,
      get: async url => {
        const query = new URL(`https://x${url}`).searchParams.get('q');
        queries.push(query);
        return { tracks: { items: answers[query] || [] } };
      }
    };
  };

  beforeEach(async () => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-match-'));
    fs.cpSync(path.join(process.cwd(), 'test/data/source/dir1'), library, { recursive: true });
    NodeId3.update({ ISRC: 'ISRC0001' }, file('testFile02.mp3'));
    config = {
      mpd: { baseDirectory: library },
      rating: { tag: 'POPM', max: 5 },
      library: {
        tags: [
          { id: 'TPE1', name: 'artist' },
          { id: 'TIT2', name: 'title' }
        ]
      },
      tags: []
    };
    db = openDatabase(':memory:');
    syncTagDefinitions(db, config);
    await updateDatabase(db, { config, target: library });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(library, { recursive: true, force: true });
  });

  const meta = name => {
    const { raw } = NodeId3.read(file(name));
    return { artist: raw.TPE1, title: raw.TIT2 };
  };

  it('should write beets, ISRC, and search matches to files and the database', async () => {
    const searched = meta('testFile03.mp3');
    const row = db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile03.mp3');
    const client = fakeClient({
      'isrc:ISRC0001': [
        track(
          'isrc-id',
          'Whatever',
          'Anyone',
          db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile02.mp3').duration
        )
      ],
      [`track:"${searched.title}" artist:"${searched.artist}"`]: [
        track('search-id', searched.title, searched.artist, row.duration)
      ]
    });
    const summary = await matchSongs({
      db,
      config,
      client,
      songs: songs(['testFile01.mp3', 'testFile02.mp3', 'testFile03.mp3']),
      beetsIds: new Map([[file('testFile01.mp3'), 'beets-id']])
    });

    expect(summary).to.include({ targets: 3, match: 3, review: 0, missing: 0, failed: 0 });
    expect(summary.bySource).to.deep.equal({ beets: 1, isrc: 1, search: 1 });
    expect(spotifyId('testFile01.mp3')).to.equal('beets-id');
    expect(spotifyId('testFile02.mp3')).to.equal('isrc-id');
    expect(spotifyId('testFile03.mp3')).to.equal('search-id');
    const stored = db
      .prepare(
        `SELECT value FROM song_tags t JOIN songs s ON s.id = t.song_id
         WHERE s.path = ? AND t.frame_id = 'TXXX.spotify_track_id'`
      )
      .get('testFile03.mp3');
    expect(stored.value).to.equal('search-id');
  });

  it('should keep probable matches for review and remember misses', async () => {
    const reviewed = meta('testFile01.mp3');
    const row = db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile01.mp3');
    const client = fakeClient({
      [`track:"${reviewed.title}" artist:"${reviewed.artist}"`]: [
        track('maybe', reviewed.title, reviewed.artist, row.duration + 20)
      ]
    });
    const summary = await matchSongs({
      db,
      config,
      client,
      songs: songs(['testFile01.mp3', 'testFile03.mp3'])
    });
    expect(summary).to.include({ match: 0, review: 1, missing: 1 });
    expect(spotifyId('testFile01.mp3')).to.be.undefined;
    expect(reviewItems(db, config).map(item => [item.path, item.candidate.id])).to.deep.equal([
      ['testFile01.mp3', 'maybe']
    ]);

    // checked recently, so neither is looked up again
    const again = fakeClient({});
    expect(
      await matchSongs({
        db,
        config,
        client: again,
        songs: songs(['testFile01.mp3', 'testFile03.mp3'])
      })
    ).to.include({
      cached: 2
    });
    expect(again.queries).to.be.empty;
  });

  it('should skip songs that already have a Spotify id or no targets', async () => {
    NodeId3.update(
      { userDefinedText: [{ description: 'spotify_track_id', value: 'existing' }] },
      file('testFile01.mp3')
    );
    await updateDatabase(db, { config, target: library });
    const client = fakeClient({});
    const summary = await matchSongs({
      db,
      config,
      client,
      songs: [...songs(['testFile01.mp3']), { file: file('testFile02.mp3'), meta: {}, targets: [] }]
    });
    expect(summary).to.include({ targets: 1, tagged: 1 });
    expect(client.queries).to.be.empty;
  });

  it('should not write files or the database in a dry run', async () => {
    const before = fs.statSync(file('testFile01.mp3')).mtimeMs;
    const summary = await matchSongs({
      db,
      config,
      client: fakeClient({}),
      songs: songs(['testFile01.mp3']),
      beetsIds: new Map([[file('testFile01.mp3'), 'beets-id']]),
      dryRun: true
    });
    expect(summary).to.include({ match: 1, dryRun: true });
    expect(fs.statSync(file('testFile01.mp3')).mtimeMs).to.equal(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM spotify_matches').get().n).to.equal(0);
  });

  it('should count lookup errors as failed and keep going', async () => {
    const client = {
      get: async () => {
        throw new Error('503');
      }
    };
    const summary = await matchSongs({
      db,
      config,
      client,
      songs: songs(['testFile01.mp3', 'testFile02.mp3'])
    });
    expect(summary).to.include({ failed: 2, match: 0 });
  });
});
