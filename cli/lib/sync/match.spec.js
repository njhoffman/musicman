const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { syncTagDefinitions } = require('../db/tags.js');
const { updateDatabase } = require('../db/update.js');
const {
  acceptReview,
  matchSongs,
  recheckMatches,
  rejectReview,
  rejectedTracks,
  reviewItems
} = require('./match.js');

describe('Spotify Id Matching', () => {
  let db;
  let library;
  let config;
  const file = name => path.join(library, name);
  const songs = names => names.map(name => ({ file: file(name), meta: {}, targets: ['liked'] }));
  const customTag = (name, description) =>
    (NodeId3.read(file(name)).raw.TXXX || [])
      .filter(t => t.description === description)
      .map(t => t.value)[0];
  const spotifyId = name => customTag(name, 'sp_track_id');
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
          meta('testFile02.mp3').title,
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

    it('should save the first artist photo for offline use, except in a dry run', async () => {
      const imageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-artists-'));
      const urls = [];
      const imageFetch = async url => {
        urls.push(url);
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('jpeg') };
      };
      const artist = { id: 'artist-1', genres: ['rock'], images: [{ url: 'https://i/big' }] };
      const run = dryRun =>
        matchSongs({
          db,
          config,
          client: fakeClient({}, { 'beets-id': fullTrack, 'artist-1': artist }),
          songs: songs(['testFile01.mp3']),
          beetsIds: new Map([[file('testFile01.mp3'), 'beets-id']]),
          refresh: true,
          dryRun,
          imageDirectory,
          imageFetch
        });
      try {
        expect((await run(true)).artistImages.saved).to.be.empty;
        expect(urls).to.be.empty;
        const summary = await run(false);
        expect(summary.artistImages).to.deep.equal({ saved: ['artist-1'], failed: [] });
        expect(fs.readdirSync(imageDirectory)).to.deep.equal(['artist-1.jpg']);
        expect(urls).to.deep.equal(['https://i/big']);
      } finally {
        fs.rmSync(imageDirectory, { recursive: true, force: true });
      }
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

  it('should cache lookups but not write files or song tags in a dry run', async () => {
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
    expect(db.prepare('SELECT status, track_id, source FROM spotify_matches').all()).to.deep.equal([
      { status: 'match', track_id: 'beets-id', source: 'beets' }
    ]);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM song_tags WHERE frame_id = 'TXXX.sp_track_id'").get().n
    ).to.equal(0);
  });

  it('should write a match cached by a dry run without searching again', async () => {
    const searched = meta('testFile03.mp3');
    const row = db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile03.mp3');
    const answers = {
      [`track:"${searched.title}" artist:"${searched.artist}"`]: [
        track('search-id', searched.title, searched.artist, row.duration)
      ]
    };
    await matchSongs({
      db,
      config,
      client: fakeClient(answers),
      songs: songs(['testFile03.mp3']),
      dryRun: true
    });
    const client = fakeClient({}, { 'search-id': track('search-id', 'T', 'A', 1) });
    const summary = await matchSongs({ db, config, client, songs: songs(['testFile03.mp3']) });
    expect(summary).to.include({ match: 1, reused: 1 });
    expect(summary.bySource).to.include({ search: 1 });
    expect(client.queries).to.deep.equal(['/tracks?ids=search-id']);
    expect(spotifyId('testFile03.mp3')).to.equal('search-id');
  });

  it('should stop at a long rate limit and skip the songs not looked up yet', async () => {
    const limited = Object.assign(new Error('rate limited'), {
      rateLimited: true,
      retryAfter: 900
    });
    const songsSeen = [];
    const client = {
      get: async () => {
        throw limited;
      }
    };
    const summary = await matchSongs({
      db,
      config,
      client,
      songs: songs(['testFile01.mp3', 'testFile02.mp3', 'testFile03.mp3']),
      onSong: status => songsSeen.push(status)
    });
    expect(summary).to.include({ failed: 0, skipped: 3 });
    expect(summary.rateLimited).to.deep.equal({ retryAfter: 900 });
    expect(songsSeen).to.be.empty;
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
  describe('review', () => {
    const tag = (name, fields) =>
      NodeId3.update(
        {
          userDefinedText: Object.entries(fields).map(([description, value]) => ({
            description,
            value
          }))
        },
        file(name)
      );
    const status = name =>
      db
        .prepare(
          `SELECT m.status, m.track_id, m.reviewed_at, m.rejected FROM spotify_matches m
           JOIN songs s ON s.id = m.song_id WHERE s.path = ?`
        )
        .get(name);

    beforeEach(async () => {
      // testFile01 is matched to another version, testFile02 to the same title
      tag('testFile01.mp3', {
        sp_track_id: 'wrong-id',
        sp_title: `${meta('testFile01.mp3').title} - Rough Mix`,
        sp_artist: 'Spotify Artist',
        sp_fetched_at: new Date().toISOString()
      });
      tag('testFile02.mp3', {
        sp_track_id: 'right-id',
        sp_title: meta('testFile02.mp3').title,
        sp_fetched_at: new Date().toISOString()
      });
      await updateDatabase(db, { config, target: library });
    });

    it('should move matches failing the title rule to review and keep them linked', () => {
      const before = fs.statSync(file('testFile01.mp3')).mtimeMs;
      const moved = recheckMatches({
        db,
        config,
        songs: songs(['testFile01.mp3', 'testFile02.mp3'])
      });
      expect(moved.map(item => item.candidate.id)).to.deep.equal(['wrong-id']);
      expect(status('testFile01.mp3')).to.include({ status: 'review', track_id: 'wrong-id' });
      expect(fs.statSync(file('testFile01.mp3')).mtimeMs).to.equal(before);
      const [item] = reviewItems(db, config);
      expect(item).to.include({ path: 'testFile01.mp3', linked: true });
    });

    it('should not move anything in a dry run or a match accepted in review', async () => {
      const all = songs(['testFile01.mp3']);
      expect(recheckMatches({ db, config, songs: all, dryRun: true })).to.have.length(1);
      expect(status('testFile01.mp3')).to.be.undefined;
      recheckMatches({ db, config, songs: all });
      await acceptReview({ db, config, client: fakeClient({}), items: reviewItems(db, config) });
      expect(status('testFile01.mp3')).to.include({ status: 'match' });
      expect(status('testFile01.mp3').reviewed_at).to.not.be.null;
      expect(recheckMatches({ db, config, songs: all })).to.be.empty;
    });

    it('should write the id and fields when accepting a match that is not linked yet', async () => {
      const searched = meta('testFile03.mp3');
      const row = db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile03.mp3');
      await matchSongs({
        db,
        config,
        client: fakeClient({
          [`track:"${searched.title}" artist:"${searched.artist}"`]: [
            track('maybe-id', searched.title, searched.artist, row.duration + 20)
          ]
        }),
        songs: songs(['testFile03.mp3'])
      });
      const items = reviewItems(db, config);
      expect(items.map(item => [item.path, item.linked])).to.deep.equal([
        ['testFile03.mp3', false]
      ]);
      const { accepted, failed } = await acceptReview({
        db,
        config,
        client: fakeClient(
          {},
          { 'maybe-id': track('maybe-id', searched.title, searched.artist, 1) }
        ),
        items
      });
      expect(failed).to.be.empty;
      expect(accepted).to.have.length(1);
      expect(spotifyId('testFile03.mp3')).to.equal('maybe-id');
      expect(status('testFile03.mp3')).to.include({ status: 'match', track_id: 'maybe-id' });
      // scored against the candidate shown in review, not the track fetched on accept
      expect(customTag('testFile03.mp3', 'sp_diff_percent')).to.equal('96');
      expect(customTag('testFile03.mp3', 'sp_diff_details')).to.equal('duration 20.0s -4');
    });

    it('should write the similarity when accepting a linked match', async () => {
      recheckMatches({ db, config, songs: songs(['testFile01.mp3']) });
      const { accepted } = await acceptReview({
        db,
        config,
        client: fakeClient({}),
        items: reviewItems(db, config)
      });
      expect(accepted).to.have.length(1);
      expect(spotifyId('testFile01.mp3')).to.equal('wrong-id');
      expect(customTag('testFile01.mp3', 'sp_diff_percent')).to.equal('90');
      expect(customTag('testFile01.mp3', 'sp_diff_details')).to.equal('suffix +rough -10');
    });

    it('should keep a candidate at least sync.autoAcceptPercent similar in review', async () => {
      const searched = meta('testFile03.mp3');
      const row = db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile03.mp3');
      const answers = {
        [`track:"${searched.title}" artist:"${searched.artist}"`]: [
          track('close-id', searched.title, searched.artist, row.duration + 10)
        ]
      };
      const summary = await matchSongs({
        db,
        config: _.merge({}, config, { sync: { autoAcceptPercent: 95 } }),
        client: fakeClient(answers, {
          'close-id': track('close-id', searched.title, searched.artist, row.duration + 10)
        }),
        songs: songs(['testFile03.mp3'])
      });
      expect(summary).to.include({ match: 0, review: 1 });
      expect(spotifyId('testFile03.mp3')).to.be.undefined;
      const [waiting] = reviewItems(db, config);
      expect(waiting.candidate.id).to.equal('close-id');
      expect(waiting.similarity.percent).to.equal(98);
    });

    it('should still write the id when accepting while track details cannot be fetched', async () => {
      const searched = meta('testFile03.mp3');
      const row = db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile03.mp3');
      await matchSongs({
        db,
        config,
        client: fakeClient({
          [`track:"${searched.title}" artist:"${searched.artist}"`]: [
            track('maybe-id', searched.title, searched.artist, row.duration + 20)
          ]
        }),
        songs: songs(['testFile03.mp3'])
      });
      const offline = {
        get: async () => {
          throw new Error('Spotify token request failed: fetch failed (ECONNRESET)');
        }
      };
      const result = await acceptReview({
        db,
        config,
        client: offline,
        items: reviewItems(db, config)
      });
      expect(result.detailsError).to.equal(
        'Spotify token request failed: fetch failed (ECONNRESET)'
      );
      expect(result.accepted).to.have.length(1);
      expect(spotifyId('testFile03.mp3')).to.equal('maybe-id');
    });

    it('should unlink a rejected match, remember the track, and look the song up again without it', async () => {
      recheckMatches({ db, config, songs: songs(['testFile01.mp3']) });
      const { rejected } = await rejectReview({ db, config, items: reviewItems(db, config) });
      expect(rejected).to.have.length(1);
      expect(spotifyId('testFile01.mp3')).to.be.undefined;
      const tags = (NodeId3.read(file('testFile01.mp3')).raw.TXXX || []).map(t => t.description);
      expect(tags.filter(name => name.startsWith('sp_'))).to.be.empty;
      expect(status('testFile01.mp3')).to.include({ status: 'rejected', track_id: null });
      expect(JSON.parse(status('testFile01.mp3').rejected)).to.deep.equal(['wrong-id']);
      expect([...rejectedTracks(db, config)]).to.deep.equal([['wrong-id', file('testFile01.mp3')]]);

      // looked up again right away, and the rejected track is never matched again
      const { title, artist } = meta('testFile01.mp3');
      const row = db.prepare('SELECT duration FROM songs WHERE path = ?').get('testFile01.mp3');
      const client = fakeClient({
        [`track:"${title}" artist:"${artist}"`]: [track('wrong-id', title, artist, row.duration)]
      });
      const summary = await matchSongs({ db, config, client, songs: songs(['testFile01.mp3']) });
      expect(client.queries.length).to.be.above(0);
      expect(summary).to.include({ match: 0, missing: 1 });
      expect(JSON.parse(status('testFile01.mp3').rejected)).to.deep.equal(['wrong-id']);
    });
  });
});
