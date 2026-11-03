const _ = require('lodash');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { getMeta, openDatabase } = require('../db/database.js');
const { syncTagDefinitions } = require('../db/tags.js');
const { updateDatabase } = require('../db/update.js');
const { rejectedCandidatesKey } = require('../sync/match.js');
const {
  acceptedList,
  changeMarkers,
  duplicatesList,
  historyList,
  missingList,
  rejectedList,
  reviewList,
  transferLists
} = require('./data.js');
const { reviewActions, reviewItem } = require('./actions.js');
const { createHandler, startServer } = require('./server.js');

const trackA = '0Q7a3AbWpEr162RRDyz5u6';
const trackB = '77exqyiyvw4D2BBmFNMUur';
const trackC = '4uLU6hMCjMI75M1A2tKUQC';

describe('musicman ui', () => {
  let db;
  let library;
  let runs;
  let config;
  const file = name => path.join(library, name);
  const customTags = name =>
    Object.fromEntries(
      (NodeId3.read(file(name)).raw.TXXX || []).map(t => [t.description, t.value])
    );
  const songId = name => db.prepare('SELECT id FROM songs WHERE path = ?').get(name).id;
  const match = name =>
    db.prepare('SELECT * FROM spotify_matches WHERE song_id = ?').get(songId(name));
  const candidate = (id, name) => ({
    id,
    name,
    artists: 'Spotify Artist',
    album: 'Spotify Album',
    durationMs: 200000
  });
  // a Spotify client answering track batches from a table of id -> track, and searches from a table of
  // query -> tracks (none for other queries)
  const fakeClient = (tracks, searches = {}) => ({
    requests: [],
    get(url) {
      this.requests.push(url);
      const search = url.match(/^\/search\?type=track&limit=\d+&q=(.*)$/);
      if (search) {
        return Promise.resolve({
          tracks: { items: searches[decodeURIComponent(search[1])] || [] }
        });
      }
      const ids = url.match(/^\/tracks\?ids=(.*)$/)[1].split(',');
      return Promise.resolve({ tracks: ids.map(id => tracks[id] || null) });
    }
  });
  const webTrack = (id, name) => ({
    id,
    name,
    artists: [{ name: 'Spotify Artist' }],
    album: { name: 'Spotify Album' },
    duration_ms: 200000
  });

  beforeEach(async () => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-ui-'));
    runs = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-ui-runs-'));
    fs.cpSync(path.join(process.cwd(), 'test/data/source/dir1'), library, { recursive: true });
    config = {
      mpd: { baseDirectory: library },
      rating: { tag: 'POPM', max: 5 },
      library: {
        tags: [
          { id: 'TPE1', name: 'artist' },
          { id: 'TIT2', name: 'title' }
        ]
      },
      tags: [],
      sync: {},
      logger: { archive: { directory: runs } }
    };
    db = openDatabase(':memory:');
    syncTagDefinitions(db, config);
    await updateDatabase(db, { config, target: library });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(library, { recursive: true, force: true });
    fs.rmSync(runs, { recursive: true, force: true });
  });

  const insertMatch = (name, fields) => {
    const row = {
      status: 'match',
      track_id: null,
      source: 'search',
      candidate: null,
      reviewed_at: null,
      rejected: null,
      ...fields
    };
    db.prepare(
      `INSERT INTO spotify_matches (song_id, status, track_id, source, candidate, reviewed_at, rejected)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      songId(name),
      row.status,
      row.track_id,
      row.source,
      row.candidate,
      row.reviewed_at,
      row.rejected
    );
  };

  // testFile01 waits for review, testFile02 was accepted, testFile03 had trackB rejected
  const seed = async () => {
    insertMatch('testFile01.mp3', {
      status: 'review',
      candidate: JSON.stringify(candidate(trackA, 'Candidate One'))
    });
    NodeId3.update(
      {
        userDefinedText: [
          { description: 'sp_track_id', value: trackA },
          { description: 'sp_title', value: 'Accepted Title' },
          { description: 'sp_artist', value: 'Spotify Artist' },
          { description: 'sp_duration_ms', value: '180000' }
        ]
      },
      file('testFile02.mp3')
    );
    await updateDatabase(db, { config, target: library });
    insertMatch('testFile02.mp3', { track_id: trackA, reviewed_at: '2026-11-01 10:00:00' });
    insertMatch('testFile03.mp3', { status: 'missing', rejected: JSON.stringify([trackB]) });
  };

  describe('lists', () => {
    beforeEach(seed);

    it('should list songs waiting for review with their candidate and similarity', () => {
      const [item] = reviewList(db, config);
      expect(item.song).to.include({ id: songId('testFile01.mp3'), path: 'testFile01.mp3' });
      expect(item.track).to.deep.include({ id: trackA, name: 'Candidate One' });
      expect(item.similarity).to.have.keys('percent', 'details');
      expect(item.linked).to.equal(false);
    });

    it('should list accepted matches with the linked track from the file fields', () => {
      const [item] = acceptedList(db);
      expect(item.song.path).to.equal('testFile02.mp3');
      expect(item.track).to.deep.equal({
        id: trackA,
        name: 'Accepted Title',
        artists: 'Spotify Artist',
        album: null,
        durationMs: 180000
      });
      expect(item.reviewedAt).to.equal('2026-11-01 10:00:00');
    });

    it('should list rejected tracks, with details once they are stored', () => {
      const [unknown] = rejectedList(db);
      expect(unknown.song.path).to.equal('testFile03.mp3');
      expect(unknown.current).to.equal(null);
      expect(unknown.rejected).to.deep.equal([
        {
          track: { id: trackB, name: null, artists: null, album: null, durationMs: null },
          similarity: null
        }
      ]);
    });

    it('should list the songs looked up without a candidate', () => {
      const list = missingList(db);
      expect(list).to.have.length(1);
      expect(list[0].song).to.include({ id: songId('testFile03.mp3'), path: 'testFile03.mp3' });
      expect(list[0].checkedAt).to.be.a('string');
    });

    it('should group the tracks to pull and the songs without an id by playlist', () => {
      const plan = [
        {
          name: 'Liked Songs',
          pull: [{ track_id: trackA, name: 'One', artists: 'A', album: 'X' }],
          noId: [{ file: file('testFile03.mp3') }]
        },
        {
          name: 'Study',
          pull: [{ track_id: trackA, name: 'One', artists: 'A', album: 'X' }],
          noId: [{ file: file('testFile03.mp3') }]
        }
      ];
      const lists = transferLists(db, config, plan);
      expect(lists.toLocal).to.deep.equal([
        {
          track: { id: trackA, name: 'One', artists: 'A', album: 'X' },
          playlists: ['Liked Songs', 'Study']
        }
      ]);
      expect(lists.toSpotify).to.have.length(1);
      expect(lists.toSpotify[0]).to.deep.include({
        status: 'missing',
        playlists: ['Liked Songs', 'Study']
      });
      expect(lists.toSpotify[0].song.path).to.equal('testFile03.mp3');
    });
  });

  describe('actions', () => {
    beforeEach(seed);

    const runReports = () =>
      fs
        .readdirSync(runs)
        .filter(name => name.endsWith('.json'))
        .map(name => JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8')));

    it('should accept a review match as a ui run with its tag changes recorded for undo', async () => {
      const client = fakeClient({ [trackA]: webTrack(trackA, 'Candidate One') });
      const actions = reviewActions({ db, config, getClient: () => client });
      const result = await actions.accept(songId('testFile01.mp3'), trackA);
      expect(result.failed).to.be.empty;
      expect(customTags('testFile01.mp3')).to.include({ sp_track_id: trackA });
      expect(match('testFile01.mp3')).to.include({ status: 'match', track_id: trackA });
      expect(match('testFile01.mp3').reviewed_at).to.be.a('string');
      const [report] = runReports();
      expect(report).to.include({ command: 'ui', status: 'ok' });
      expect(report.args).to.deep.equal(['accept', 'testFile01.mp3', trackA]);
      const changes = db
        .prepare('SELECT frame FROM tag_changes WHERE run_id = ?')
        .all(report.id)
        .map(({ frame }) => frame);
      expect(changes).to.include('TXXX.sp_track_id');
    });

    it('should reject an accepted match: unlink the file and remember the track', async () => {
      const actions = reviewActions({ db, config, getClient: () => null });
      await actions.reject(songId('testFile02.mp3'), trackA);
      expect(_.keys(customTags('testFile02.mp3')).filter(key => key.startsWith('sp_'))).to.be.empty;
      expect(JSON.parse(match('testFile02.mp3').rejected)).to.deep.equal([trackA]);
      expect(getMeta(db, rejectedCandidatesKey)[trackA]).to.include({ name: 'Accepted Title' });
    });

    it('should accept a rejected track after all and take it off the rejected tracks', async () => {
      const client = fakeClient({ [trackB]: webTrack(trackB, 'Second Look') });
      const actions = reviewActions({ db, config, getClient: () => client });
      await actions.accept(songId('testFile03.mp3'), trackB);
      expect(customTags('testFile03.mp3')).to.include({ sp_track_id: trackB });
      expect(match('testFile03.mp3')).to.include({ status: 'match', rejected: null });
    });

    it('should accept a track a search found, scored against the details the search returned', async () => {
      const id = songId('testFile03.mp3');
      const found = candidate(trackC, 'Found By Search');
      expect(reviewItem(db, config, id, trackC).candidate).to.deep.equal({ id: trackC });
      expect(
        reviewItem(db, config, id, trackC, new Map([[trackC, found]])).candidate
      ).to.deep.equal(found);
      const actions = reviewActions({ db, config, getClient: () => null });
      actions.remember([found]);
      const result = await actions.accept(id, trackC);
      expect(result.failed).to.be.empty;
      expect(customTags('testFile03.mp3')).to.include({ sp_track_id: trackC });
      expect(customTags('testFile03.mp3')).to.have.property('sp_diff_percent');
      expect(match('testFile03.mp3')).to.include({ status: 'match', track_id: trackC });
    });

    it('should undo an accept of the page, list it in the history, and refuse to undo it twice', async () => {
      const id = songId('testFile01.mp3');
      const actions = reviewActions({ db, config, getClient: () => null });
      await actions.accept(id, trackA);
      expect(match('testFile01.mp3')).to.include({ status: 'match' });
      const [accepted] = historyList(db, config);
      expect(accepted.args).to.deep.equal(['accept', 'testFile01.mp3', trackA]);
      expect(accepted.files).to.deep.equal([
        {
          path: 'testFile01.mp3',
          frames: ['TXXX.sp_track_id', 'TXXX.sp_diff_percent', 'TXXX.sp_diff_details'],
          status: 'restore',
          changed: []
        }
      ]);
      expect(accepted.matches).to.deep.equal([
        { path: 'testFile01.mp3', before: 'review', status: 'restore' }
      ]);
      const result = await actions.undo(accepted.id);
      expect(result.matches).to.deep.equal([id]);
      expect(match('testFile01.mp3')).to.include({ status: 'review', reviewed_at: null });
      expect(customTags('testFile01.mp3')).to.not.have.property('sp_track_id');
      const [undo, again] = historyList(db, config);
      expect(undo).to.include({ undoes: accepted.id });
      expect(again).to.include({ id: accepted.id, undoneBy: undo.id });
      expect(() => actions.undo(accepted.id)).to.throw('already undone');
      expect(() => actions.undo('20261020-000000-sync')).to.throw('No run');
      expect(_.map(runReports(), 'args')).to.deep.include(['undo', accepted.id]);
    });

    it('should run actions one after another and fail for an unknown song', async () => {
      const actions = reviewActions({ db, config, getClient: () => null });
      expect(() => actions.accept(99999, trackA)).to.throw('No song 99999');
      await Promise.all([
        actions.reject(songId('testFile01.mp3'), trackA),
        actions.reject(songId('testFile02.mp3'), trackA)
      ]);
      expect(runReports()).to.have.length(2);
    });
  });

  describe('duplicates', () => {
    // one single in two grouping folders (picked in the page), with one Spotify track and a title of
    // their own (testFile01 has the same artist and length)
    const copies = ['Rated/X/Singles/A - Song.mp3', 'Rated/Y/Singles/A - Song.mp3'];
    let beetCalls;
    const beet = async args => {
      beetCalls.push(args);
      return '';
    };

    beforeEach(async () => {
      beetCalls = [];
      copies.forEach(copy => {
        fs.mkdirSync(path.dirname(file(copy)), { recursive: true });
        fs.copyFileSync(file('testFile01.mp3'), file(copy));
        NodeId3.update(
          {
            title: 'Copied Song',
            userDefinedText: [{ description: 'sp_track_id', value: trackC }]
          },
          file(copy)
        );
      });
      config.db = { backupDirectory: path.join(library, '.musicman') };
      await updateDatabase(db, { config, target: library });
    });

    it('should list the groups with what happens to each copy', async () => {
      const [group] = await duplicatesList(db, config);
      expect(group).to.include({ key: copies.join('|'), keep: null });
      expect(group.candidates).to.deep.equal(copies);
      expect(group.copies.map(({ song, action }) => [song.path, action])).to.deep.equal([
        [copies[0], 'pick'],
        [copies[1], 'pick']
      ]);
      // the copies are the same audio (both from testFile01) with titles as close to their names
      expect(group.sameAudio).to.be.true;
      expect(group.copies.map(({ audio }) => audio)).to.have.length(2);
      expect(group.copies[0].audio).to.equal(group.copies[1].audio).and.to.have.length(8);
    });

    it('should drop the copy not picked as a ui run that undo takes back, its file kept', async () => {
      const actions = reviewActions({ db, config, getClient: () => null, beet });
      await actions.duplicates([{ files: copies }]).then(
        () => expect.fail('should reject'),
        err => expect(err.status).to.equal(400)
      );
      const result = await actions.duplicates([{ files: copies, keep: copies[1] }]);
      expect(result.excluded.map(({ file: dropped }) => dropped)).to.deep.equal([copies[0]]);
      expect(result.removed).to.be.empty;
      expect(fs.existsSync(file(copies[0]))).to.be.true;
      expect(beetCalls).to.be.empty;
      expect(await duplicatesList(db, config)).to.be.empty;
      const [run] = historyList(db, config);
      expect(run.args).to.deep.equal(['duplicates', copies[1]]);
      expect(run.moves).to.deep.equal([{ action: 'exclude', path: copies[0], status: 'restore' }]);
      await actions.undo(run.id);
      expect(fs.existsSync(file(copies[0]))).to.be.true;
      expect((await duplicatesList(db, config)).length).to.equal(1);
    });
  });

  describe('changeMarkers', () => {
    it('should change the review marker on a review change and the transfers marker on any', async () => {
      await seed();
      const before = changeMarkers(db);
      db.prepare('UPDATE spotify_matches SET rejected = \'["x"]\' WHERE song_id = ?').run(
        songId('testFile01.mp3')
      );
      const rejected = changeMarkers(db);
      expect(rejected.review).to.not.equal(before.review);
      expect(rejected.transfers).to.not.equal(before.transfers);
      db.prepare(
        "INSERT INTO spotify_playlists (id, name, synced_at) VALUES ('p', 'P', '2026-11-01 10:00:00')"
      ).run();
      const synced = changeMarkers(db);
      expect(synced.review).to.equal(rejected.review);
      expect(synced.transfers).to.not.equal(rejected.transfers);
    });
  });

  describe('server', () => {
    let server;
    let base;
    const calls = [];

    let client;
    let userToken;
    let planCalls;

    beforeEach(async () => {
      userToken = async () => ({ accessToken: 'user-token', scope: 'streaming user-read-email' });
      await seed();
      calls.length = 0;
      planCalls = 0;
      client = fakeClient(
        { [trackB]: webTrack(trackB, 'Fetched Name') },
        {
          'title words': [webTrack(trackC, 'Title Words'), webTrack(trackB, 'Rejected Before')]
        }
      );
      const handler = createHandler({
        db,
        config,
        actions: {
          accept: async (id, trackId) => {
            calls.push(['accept', id, trackId]);
            return { accepted: [{}], failed: [] };
          },
          reject: async (id, trackId) => {
            calls.push(['reject', id, trackId]);
            return { rejected: [], failed: [{ error: 'could not write tags' }] };
          },
          remember: candidates => calls.push(['remember', _.map(candidates, 'id')]),
          duplicates: async groups => {
            calls.push(['duplicates', groups]);
            return { removed: [{}], excluded: [], cleared: [], merged: [{}], failed: [] };
          },
          undo: async (runId, options) => {
            calls.push(['undo', runId, options]);
            if (runId === 'gone') {
              const err = new Error('No run gone of the page');
              err.status = 404;
              throw err;
            }
            return { tags: { restored: [{}], failed: [] }, matches: [1], failed: [] };
          }
        },
        getClient: () => client,
        librarySongs: async () => [],
        plan: () => {
          planCalls += 1;
          return [
            {
              id: 'liked',
              name: 'Liked Songs',
              pull: [{ track_id: trackC, name: 'Wanted', artists: 'Artist', album: 'Album' }],
              noId: []
            }
          ];
        },
        player: { open: async uri => calls.push(['open', uri]) },
        getUserToken: () => userToken(),
        refreshPlaylists: async () => {
          calls.push(['refresh']);
          return { refreshed: ['liked', 'p1'], unchanged: ['p2'] };
        }
      });
      server = await startServer(handler, { port: 0 });
      base = `http://127.0.0.1:${server.address().port}`;
    });

    afterEach(async () => {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    });

    const post = (url, body) =>
      fetch(`${base}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

    it('should list the duplicate groups and repair the groups sent, refusing malformed ones', async () => {
      const listed = await (await fetch(`${base}/api/duplicates`)).json();
      expect(listed.groups).to.be.an('array');
      expect(listed.marker).to.equal(changeMarkers(db).duplicates);
      const groups = [{ files: ['a.mp3', 'b.mp3'], keep: 'b.mp3' }];
      const response = await post('/api/duplicates', { groups });
      expect(await response.json()).to.deep.include({ ok: true, removed: 1, merged: 1 });
      expect(calls).to.deep.equal([['duplicates', groups]]);
      for (const body of [
        {},
        { groups: [] },
        { groups: [{ files: ['one.mp3'] }] },
        { groups: [{ files: ['a', 'b'], keep: 3 }] }
      ]) {
        expect((await post('/api/duplicates', body)).status).to.equal(400);
      }
    });

    it('should serve the page and its files, and nothing outside them', async () => {
      const page = await fetch(`${base}/`);
      expect(page.status).to.equal(200);
      expect(page.headers.get('content-type')).to.include('text/html');
      expect(await page.text()).to.include('<script type="module" src="/app.js">');
      expect((await fetch(`${base}/app.js`)).headers.get('content-type')).to.include(
        'text/javascript'
      );
      expect((await fetch(`${base}/%2e%2e/ui.spec.js`)).status).to.equal(404);
      expect((await fetch(`${base}/api/nothing`)).status).to.equal(404);
    });

    it('should list the review lists and look up rejected tracks known only by id', async () => {
      const body = await (await fetch(`${base}/api/review`)).json();
      expect(body.review).to.have.length(1);
      expect(body.accepted).to.have.length(1);
      expect(body.rejected[0].rejected[0].track).to.include({ id: trackB, name: 'Fetched Name' });
      expect(getMeta(db, rejectedCandidatesKey)[trackB]).to.include({ name: 'Fetched Name' });
    });

    it('should list the transfers with the time of the last sync', async () => {
      const body = await (await fetch(`${base}/api/transfers`)).json();
      expect(body).to.have.keys('syncedAt', 'toLocal', 'toSpotify', 'marker', 'computedAt');
      expect(body.marker).to.equal(changeMarkers(db).transfers);
    });

    it('should keep the transfer lists until the database changes, or until asked fresh', async () => {
      const first = await (await fetch(`${base}/api/transfers`)).json();
      await Promise.all([fetch(`${base}/api/transfers`), fetch(`${base}/api/transfers`)]);
      expect(planCalls).to.equal(1);
      expect((await (await fetch(`${base}/api/transfers`)).json()).computedAt).to.equal(
        first.computedAt
      );
      await fetch(`${base}/api/transfers?fresh`);
      expect(planCalls).to.equal(2);
      db.prepare(
        "INSERT INTO spotify_playlists (id, name, synced_at) VALUES ('p', 'P', '2026-11-01 11:00:00')"
      ).run();
      const changed = await (await fetch(`${base}/api/transfers`)).json();
      expect(planCalls).to.equal(3);
      expect(changed.marker).to.not.equal(first.marker);
    });

    it('should report the change markers and the runs of other commands going on now', async () => {
      const report = (name, fields) =>
        fs.writeFileSync(path.join(runs, `${name}.json`), JSON.stringify(fields));
      report('20261101-100000-sync', {
        id: '20261101-100000-sync',
        command: 'sync',
        args: ['sync', '--match'],
        startedAt: '2026-11-01T10:00:00.000Z',
        status: 'running',
        pid: process.pid
      });
      report('20261101-100001-ui', {
        id: 'ui',
        command: 'ui',
        status: 'running',
        pid: process.pid
      });
      const body = await (await fetch(`${base}/api/status`)).json();
      expect(body.markers).to.deep.equal(changeMarkers(db));
      expect(body.running).to.deep.equal([
        {
          id: '20261101-100000-sync',
          command: 'sync',
          args: ['sync', '--match'],
          startedAt: '2026-11-01T10:00:00.000Z'
        }
      ]);
      const review = await (await fetch(`${base}/api/review`)).json();
      expect(review.marker).to.equal(body.markers.review);
      expect(body.download).to.include({ running: null, queued: 0 });
    });

    it('should refuse to start or cancel a download with nothing to download or running', async () => {
      const start = await post('/api/downloads/run', {});
      expect(start.status).to.equal(400);
      expect((await start.json()).error).to.match(/No download manifest yet/);
      const cancel = await post('/api/downloads/cancel', {});
      expect(cancel.status).to.equal(409);
      expect((await cancel.json()).error).to.equal('No download is running');
    });

    it('should stream a song whole or by byte range', async () => {
      const id = songId('testFile01.mp3');
      const size = fs.statSync(file('testFile01.mp3')).size;
      const whole = await fetch(`${base}/api/songs/${id}/audio`);
      expect(whole.status).to.equal(200);
      expect(whole.headers.get('content-type')).to.equal('audio/mpeg');
      expect((await whole.arrayBuffer()).byteLength).to.equal(size);
      const part = await fetch(`${base}/api/songs/${id}/audio`, {
        headers: { Range: 'bytes=10-19' }
      });
      expect(part.status).to.equal(206);
      expect(part.headers.get('content-range')).to.equal(`bytes 10-19/${size}`);
      expect((await part.arrayBuffer()).byteLength).to.equal(10);
      const tail = await fetch(`${base}/api/songs/${id}/audio`, { headers: { Range: 'bytes=-5' } });
      expect(tail.headers.get('content-range')).to.equal(`bytes ${size - 5}-${size - 1}/${size}`);
      const beyond = await fetch(`${base}/api/songs/${id}/audio`, {
        headers: { Range: `bytes=${size}-` }
      });
      expect(beyond.status).to.equal(416);
      expect((await fetch(`${base}/api/songs/99999/audio`)).status).to.equal(404);
    });

    it('should refuse a song whose path leaves the library', async () => {
      db.prepare("UPDATE songs SET path = '../outside.mp3' WHERE path = 'testFile01.mp3'").run();
      const response = await fetch(`${base}/api/songs/${songId('../outside.mp3')}/audio`);
      expect(response.status).to.equal(403);
    });

    it('should accept and reject with a track id, and report a failed write', async () => {
      const id = songId('testFile01.mp3');
      const accepted = await post(`/api/songs/${id}/accept`, { trackId: trackA });
      expect(accepted.status).to.equal(200);
      expect(await accepted.json()).to.include({ ok: true, action: 'accept', trackId: trackA });
      const rejected = await post(`/api/songs/${id}/reject`, { trackId: trackA });
      expect(rejected.status).to.equal(500);
      expect(await rejected.json()).to.deep.equal({ error: 'could not write tags' });
      expect(calls).to.deep.equal([
        ['accept', id, trackA],
        ['reject', id, trackA]
      ]);
    });

    it('should refuse track ids that are not Spotify ids and bodies that are not JSON', async () => {
      const id = songId('testFile01.mp3');
      expect((await post(`/api/songs/${id}/accept`, { trackId: 'x; rm' })).status).to.equal(400);
      const notJson = await fetch(`${base}/api/songs/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
      });
      expect(notJson.status).to.equal(400);
      expect(calls).to.be.empty;
    });

    // a request with any headers, Host included (fetch does not let it be set)
    const raw = (method, url, headers, body) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port: server.address().port, method, path: url, headers },
          res => {
            let text = '';
            res.on('data', chunk => {
              text += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, body: text }));
          }
        );
        req.on('error', reject);
        req.end(body);
      });

    it('should refuse a Host that is not this server, so a rebinding site cannot read it', async () => {
      const port = server.address().port;
      expect((await raw('GET', '/api/review', { Host: `evil.example:${port}` })).status).to.equal(
        403
      );
      expect((await raw('GET', '/api/review', { Host: '127.0.0.1:1' })).status).to.equal(403);
      expect((await raw('GET', '/api/review', { Host: `localhost:${port}` })).status).to.equal(200);
    });

    it('should refuse a cross-site text/plain POST and one from another origin', async () => {
      const port = server.address().port;
      const id = songId('testFile01.mp3');
      const body = JSON.stringify({ trackId: trackA });
      const plain = await raw(
        'POST',
        `/api/songs/${id}/reject`,
        { Host: `127.0.0.1:${port}`, 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
        body
      );
      expect(plain.status).to.equal(415);
      const foreign = await raw(
        'POST',
        `/api/songs/${id}/reject`,
        {
          Host: `127.0.0.1:${port}`,
          'Content-Type': 'application/json',
          Origin: 'https://evil.example'
        },
        body
      );
      expect(foreign.status).to.equal(403);
      const page = await raw(
        'POST',
        `/api/songs/${id}/accept`,
        {
          Host: `127.0.0.1:${port}`,
          'Content-Type': 'application/json; charset=utf-8',
          Origin: `http://127.0.0.1:${port}`
        },
        body
      );
      expect(page.status).to.equal(200);
      expect(calls).to.deep.equal([['accept', id, trackA]]);
    });

    it('should list the songs without a candidate with the review lists', async () => {
      const body = await (await fetch(`${base}/api/review`)).json();
      expect(_.map(body.missing, 'song.path')).to.deep.equal(['testFile03.mp3']);
    });

    it('should search Spotify for a song, mark tracks rejected before, and remember the results', async () => {
      const id = songId('testFile03.mp3');
      const response = await fetch(`${base}/api/spotify/search?song=${id}&q=title%20words`);
      expect(response.status).to.equal(200);
      const body = await response.json();
      expect(body.query).to.equal('title words');
      expect(_.map(body.tracks, 'track.id')).to.deep.equal([trackC, trackB]);
      expect(body.tracks[0].track).to.deep.equal({
        id: trackC,
        name: 'Title Words',
        artists: 'Spotify Artist',
        album: 'Spotify Album',
        durationMs: 200000
      });
      expect(body.tracks[0].similarity).to.have.keys('percent', 'details');
      expect(_.map(body.tracks, 'rejected')).to.deep.equal([false, true]);
      expect(calls).to.deep.equal([['remember', [trackC, trackB]]]);
    });

    it('should search with the queries of sync --match without a query of its own', async () => {
      const id = songId('testFile03.mp3');
      const body = await (await fetch(`${base}/api/spotify/search?song=${id}`)).json();
      // nothing found: both queries were tried and the last one is reported
      const searches = client.requests.filter(url => url.startsWith('/search'));
      expect(searches).to.have.length(2);
      expect(decodeURIComponent(searches[0])).to.include('track:"');
      expect(body.tracks).to.deep.equal([]);
      expect(decodeURIComponent(searches[1])).to.include(body.query);
    });

    it('should search for a song without a title tag by its file name', async () => {
      const id = songId('testFile03.mp3');
      db.prepare("DELETE FROM song_tags WHERE song_id = ? AND frame_id = 'TIT2'").run(id);
      const body = await (await fetch(`${base}/api/spotify/search?song=${id}`)).json();
      expect(body.query).to.equal('testFile03');
    });

    it('should refuse a search without a song, with a long query, or without credentials', async () => {
      const id = songId('testFile03.mp3');
      expect((await fetch(`${base}/api/spotify/search?q=x`)).status).to.equal(400);
      expect((await fetch(`${base}/api/spotify/search?song=99999`)).status).to.equal(404);
      const long = 'x'.repeat(251);
      expect((await fetch(`${base}/api/spotify/search?song=${id}&q=${long}`)).status).to.equal(400);
      client = null;
      const missing = await fetch(`${base}/api/spotify/search?song=${id}&q=x`);
      expect(missing.status).to.equal(503);
      expect((await missing.json()).error).to.include('credentials');
    });

    it('should give the page the user token only with the streaming permission', async () => {
      const ok = await fetch(`${base}/api/spotify/token`);
      expect(ok.status).to.equal(200);
      expect(ok.headers.get('cache-control')).to.equal('no-store');
      expect(await ok.json()).to.deep.equal({ accessToken: 'user-token' });
      userToken = async () => ({ accessToken: 'user-token', scope: 'user-read-playback-state' });
      const noScope = await fetch(`${base}/api/spotify/token`);
      expect(noScope.status).to.equal(409);
      expect((await noScope.json()).error).to.include('musicman sync --login');
      userToken = async () => {
        throw new Error('Not logged in to Spotify, run: musicman sync --login');
      };
      const loggedOut = await fetch(`${base}/api/spotify/token`);
      expect(loggedOut.status).to.equal(503);
      expect(await loggedOut.json()).to.deep.equal({
        error: 'Not logged in to Spotify, run: musicman sync --login'
      });
    });

    it('should not hand the token to a page on another Host', async () => {
      const port = server.address().port;
      const response = await raw('GET', '/api/spotify/token', { Host: `evil.example:${port}` });
      expect(response.status).to.equal(403);
      expect(response.body).to.not.include('user-token');
    });

    it('should add Spotify to local tracks to the download manifest and show where each is', async () => {
      config.sync.downloadDirectory = path.join(library, '.musicman', 'download');
      const before = await (await fetch(`${base}/api/transfers`)).json();
      expect(before.toLocal).to.deep.equal([
        {
          track: { id: trackC, name: 'Wanted', artists: 'Artist', album: 'Album' },
          playlists: ['Liked Songs'],
          download: null
        }
      ]);
      const added = await post('/api/downloads', { trackIds: [trackC] });
      expect(await added.json()).to.deep.equal({ ok: true, added: [trackC], unknown: [] });
      const manifest = JSON.parse(
        fs.readFileSync(path.join(config.sync.downloadDirectory, 'manifest.json'), 'utf8')
      );
      expect(_.map(manifest.tracks, 'trackId')).to.deep.equal([trackC]);
      const after = await (await fetch(`${base}/api/transfers`)).json();
      expect(after.toLocal[0].download).to.equal('queued');
      // the lists were kept: only the download status was read again
      expect(planCalls).to.equal(1);
      expect((await post('/api/downloads', { trackIds: [trackA] })).status).to.equal(409);
      expect((await post('/api/downloads', { trackIds: ['nope'] })).status).to.equal(400);
      expect((await post('/api/downloads', {})).status).to.equal(400);
    });

    it('should refresh the cached playlists', async () => {
      const response = await post('/api/spotify/refresh', {});
      expect(await response.json()).to.deep.equal({ ok: true, refreshed: 2, unchanged: 1 });
      expect(calls).to.deep.equal([['refresh']]);
    });

    it('should list the history with its marker and undo a run', async () => {
      const body = await (await fetch(`${base}/api/history`)).json();
      expect(body).to.deep.equal({ runs: [], marker: changeMarkers(db).history });
      const undone = await post('/api/history/20261101-100000-ui/undo', { force: true });
      expect(await undone.json()).to.deep.equal({ ok: true, files: 1, matches: 1, moves: 0 });
      expect((await post('/api/history/gone/undo', {})).status).to.equal(404);
      expect(calls).to.deep.equal([
        ['undo', '20261101-100000-ui', { force: true }],
        ['undo', 'gone', { force: false }]
      ]);
    });

    it('should play a track in the Spotify app', async () => {
      const response = await post('/api/spotify/open', { trackId: trackB });
      expect(response.status).to.equal(200);
      expect(calls).to.deep.equal([['open', `spotify:track:${trackB}`]]);
    });
  });
});
