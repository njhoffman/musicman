const _ = require('lodash');
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
      .filter(t => t.description === 'sp_track_id')
      .map(t => t.value)[0];
  const track = (id, name, artist, seconds) => ({
    id,
    name,
    artists: [{ name: artist }],
    album: { name: 'Album' },
    duration_ms: seconds * 1000
  });

  // fake Web API client answering searches from a table of query -> tracks, and track, album, and
  // artist batches from a table of id -> object
  const fakeClient = (answers, objects = {}) => {
    const queries = [];
    return {
      queries,
      get: async url => {
        const batch = url.match(/^\/(tracks|albums|artists)\?ids=(.*)$/);
        if (batch) {
          queries.push(url);
          return { [batch[1]]: batch[2].split(',').map(id => objects[id] || null) };
        }
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
         WHERE s.path = ? AND t.frame_id = 'TXXX.sp_track_id'`
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
      {
        userDefinedText: [
          { description: 'sp_track_id', value: 'existing' },
          { description: 'sp_fetched_at', value: new Date().toISOString() }
        ]
      },
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

  describe('Spotify fields', () => {
    const custom = name =>
      Object.fromEntries(
        (NodeId3.read(file(name)).raw.TXXX || []).map(t => [t.description, t.value])
      );
    const fullTrack = {
      id: 'beets-id',
      name: 'Spotify Title',
      popularity: 61,
      artists: [{ id: 'artist-1', name: 'Spotify Artist' }],
      album: { id: 'album-1', name: 'Spotify Album' },
      external_ids: { isrc: 'USABC0000001' }
    };
    const now = new Date('2026-10-20T10:00:00Z');

    beforeEach(async () => {
      config.tags = [{ id: 'TSRC', name: 'isrc_code' }];
      config.spotify = {
        fields: [
          { path: 'track.name', name: 'sp_title', fallback: 'title' },
          { path: 'track.popularity', name: 'sp_popularity' },
          { path: 'track.external_ids.isrc', name: 'sp_isrc', fallback: 'isrc_code' },
          { path: 'artist.genres[]', name: 'sp_genres', multi: true }
        ],
        ignore: ['album', 'artists', 'artist.id']
      };
    });

    it('should write mapped fields and fill only empty standard tags', async () => {
      const results = [];
      const before = meta('testFile01.mp3');
      const summary = await matchSongs({
        db,
        config,
        client: fakeClient(
          {},
          { 'beets-id': fullTrack, 'artist-1': { id: 'artist-1', genres: ['rock'], popularity: 3 } }
        ),
        songs: songs(['testFile01.mp3']),
        beetsIds: new Map([[file('testFile01.mp3'), 'beets-id']]),
        now,
        onSong: (status, item, result) => results.push([status, result.writes])
      });
      expect(custom('testFile01.mp3')).to.include({
        sp_track_id: 'beets-id',
        sp_fetched_at: '2026-10-20T10:00:00.000Z',
        sp_title: 'Spotify Title',
        sp_popularity: '61',
        sp_isrc: 'USABC0000001',
        sp_genres: 'rock'
      });
      // the title is kept, the empty ISRC is filled
      expect(meta('testFile01.mp3').title).to.equal(before.title);
      expect(NodeId3.read(file('testFile01.mp3')).raw.TSRC).to.equal('USABC0000001');
      const [[status, writes]] = results;
      expect(status).to.equal('match');
      expect(_.map(writes.filled, 'name')).to.deep.equal(['isrc_code']);
      expect(_.map(writes.kept, 'name')).to.deep.equal(['title']);
      expect(summary.unassigned).to.deep.equal({ 'artist.popularity': 1 });
    });

    it('should refresh fields that were never fetched or are older than refreshDays', async () => {
      const tag = (name, fetchedAt) =>
        NodeId3.update(
          {
            userDefinedText: [
              { description: 'sp_track_id', value: 'beets-id' },
              ...(fetchedAt ? [{ description: 'sp_fetched_at', value: fetchedAt }] : [])
            ]
          },
          file(name)
        );
      tag('testFile01.mp3', null);
      tag('testFile02.mp3', '2026-09-01T00:00:00.000Z');
      tag('testFile03.mp3', '2026-10-15T00:00:00.000Z');
      await updateDatabase(db, { config, target: library });
      const run = refresh =>
        matchSongs({
          db,
          config,
          client: fakeClient({}, { 'beets-id': fullTrack }),
          songs: songs(['testFile01.mp3', 'testFile02.mp3', 'testFile03.mp3']),
          now,
          refresh,
          dryRun: true
        });
      expect(await run(false)).to.include({ refresh: 2, tagged: 1, match: 0 });
      expect(await run(true)).to.include({ refresh: 3, tagged: 0 });
    });

    it('should write the id alone when the track details cannot be fetched', async () => {
      const results = [];
      const summary = await matchSongs({
        db,
        config,
        client: fakeClient({}, {}),
        songs: songs(['testFile01.mp3']),
        beetsIds: new Map([[file('testFile01.mp3'), 'beets-id']]),
        onSong: (status, item, result) => results.push(result.error)
      });
      expect(summary).to.include({ match: 1 });
      expect(
        _.pickBy(custom('testFile01.mp3'), (value, key) => key.startsWith('sp_'))
      ).to.deep.equal({ sp_track_id: 'beets-id' });
      expect(results).to.deep.equal(['track beets-id not found on Spotify']);
    });
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
