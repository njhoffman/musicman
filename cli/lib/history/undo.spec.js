const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { syncTagDefinitions } = require('../db/tags.js');
const { updateDatabase } = require('../db/update.js');
const { rewriteTags, updateTags } = require('../metadata/write.js');
const { pushPlan } = require('../sync/push.js');
const { saveSnapshot } = require('../sync/snapshot.js');
const {
  beginJournal,
  endJournal,
  parseValue,
  pruneHistory,
  recordSpotifySnapshot,
  serialize
} = require('./journal.js');
const { applyUndo, findHistoryRun, listHistory, planUndo, undoTags } = require('./undo.js');

describe('Undo History', () => {
  let db;
  let library;
  let config;
  const file = name => path.join(library, name);
  const raw = name => NodeId3.read(file(name)).raw;
  const custom = (name, description) =>
    _.get(_.find([].concat(raw(name).TXXX || []), { description }), 'value');
  let clock = 0;
  const begin = (id, command = 'edit') => {
    clock += 1;
    return beginJournal({
      run: {
        id,
        command,
        args: [command],
        startedAt: new Date(Date.UTC(2026, 9, 24, 0, 0, clock))
      },
      config,
      db
    });
  };
  const run = id => findHistoryRun(listHistory(db), id);

  beforeEach(async () => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-undo-'));
    fs.cpSync(path.join(process.cwd(), 'test/data/source/dir1'), library, { recursive: true });
    config = {
      mpd: { baseDirectory: library },
      db: { backupDirectory: library },
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
    endJournal();
    db.close();
    fs.rmSync(library, { recursive: true, force: true });
  });

  it('should keep Buffers through serialize and parseValue', () => {
    const value = { owner: 'x', identifier: Buffer.from([1, 2, 3]) };
    expect(parseValue(serialize(value))).to.deep.equal(value);
  });

  it('should record only the frames a write changes, nothing without a run', () => {
    updateTags({ TIT2: 'Not Recorded' }, file('testFile01.mp3'));
    expect(listHistory(db)).to.be.empty;
    const title = raw('testFile02.mp3').TIT2;
    begin('r1');
    updateTags(
      { TIT2: 'New Title', userDefinedText: [{ description: 'mood', value: 'calm' }] },
      file('testFile02.mp3')
    );
    endJournal();
    const rows = db.prepare('SELECT path, frame, before FROM tag_changes ORDER BY frame').all();
    expect(rows.map(({ frame, before }) => [frame, before])).to.deep.equal([
      ['TIT2', JSON.stringify(title)],
      ['TXXX.mood', null]
    ]);
    expect(run('latest')).to.include({ id: 'r1', files: 1, frames: 2, spotify: 0 });
  });

  it('should restore the values from before the run, the first of several writes', async () => {
    const title = raw('testFile02.mp3').TIT2;
    begin('r1');
    updateTags({ TIT2: 'First' }, file('testFile02.mp3'));
    updateTags(
      { TIT2: 'Second', userDefinedText: [{ description: 'mood', value: 'calm' }] },
      file('testFile02.mp3')
    );
    endJournal();
    const plan = planUndo(db, run('r1'));
    expect(_.map(plan.files, 'status')).to.deep.equal(['restore']);
    const { restored, failed } = await undoTags({ db, config, plan });
    expect(failed).to.be.empty;
    expect(restored).to.have.length(1);
    expect(raw('testFile02.mp3').TIT2).to.equal(title);
    expect(custom('testFile02.mp3', 'mood')).to.be.undefined;
  });

  it('should hold back files changed since the run unless forced, and report missing ones', () => {
    begin('r1');
    updateTags({ TIT2: 'Run Title' }, file('testFile01.mp3'));
    updateTags({ TIT2: 'Run Title' }, file('testFile02.mp3'));
    endJournal();
    updateTags({ TIT2: 'Edited Later' }, file('testFile01.mp3'));
    fs.rmSync(file('testFile02.mp3'));
    const plan = planUndo(db, run('r1'));
    expect(plan.files.map(({ status, changed }) => [status, changed])).to.deep.equal([
      ['changed', ['TIT2']],
      ['missing', []]
    ]);
    expect(planUndo(db, run('r1'), { force: true }).files[0].status).to.equal('restore');
  });

  it('should restore TXXX fields removed by a rewrite', async () => {
    updateTags(
      { userDefinedText: [{ description: 'sp_track_id', value: 'abc' }] },
      file('testFile03.mp3')
    );
    begin('r1', 'sync');
    rewriteTags(file('testFile03.mp3'), tags => ({
      ...tags,
      TXXX: _.reject([].concat(tags.TXXX || []), ({ description }) => /^sp_/.test(description))
    }));
    endJournal();
    expect(custom('testFile03.mp3', 'sp_track_id')).to.be.undefined;
    await undoTags({ db, config, plan: planUndo(db, run('r1')) });
    expect(custom('testFile03.mp3', 'sp_track_id')).to.equal('abc');
  });

  it('should mark a run undone by the undo run, which is recorded and can be undone too', async () => {
    const title = raw('testFile01.mp3').TIT2;
    begin('r1');
    updateTags({ TIT2: 'Run Title' }, file('testFile01.mp3'));
    endJournal();
    begin('r2', 'undo');
    await applyUndo({ db, config, plan: planUndo(db, run('r1')) });
    endJournal();
    expect(raw('testFile01.mp3').TIT2).to.equal(title);
    expect(run('r1')).to.include({ undoneBy: 'r2' });
    expect(run('r2')).to.include({ undoes: 'r1', files: 1 });
    await undoTags({ db, config, plan: planUndo(db, run('r2')) });
    expect(raw('testFile01.mp3').TIT2).to.equal('Run Title');
  });

  it('should keep the newest runs and drop the changes of older ones', () => {
    ['r1', 'r2', 'r3'].forEach(id => {
      begin(id);
      updateTags({ TIT2: id }, file('testFile01.mp3'));
      endJournal();
    });
    expect(pruneHistory(db, 2)).to.equal(1);
    expect(_.map(listHistory(db), 'id')).to.deep.equal(['r3', 'r2']);
    expect(db.prepare('SELECT count(*) AS n FROM tag_changes').get().n).to.equal(2);
  });

  describe('Spotify', () => {
    const playlistId = '5MUDXMSHkjbA2CIYXjj1Vz';
    let spotify;
    // fake Web API with Liked Songs and one playlist as lists of track ids
    const fakeClient = () => {
      const requests = [];
      const items = (ids, key) => ids.map(id => ({ [key]: { id }, added_at: null }));
      return {
        requests,
        request: async (method, url, body) => {
          requests.push([method, url, body]);
          const ids =
            body.ids || _.map(body.items || body.uris, item => (item.uri || item).split(':')[2]);
          if (url === '/me/tracks') {
            spotify.liked =
              method === 'PUT'
                ? _.uniq([...spotify.liked, ...ids])
                : _.difference(spotify.liked, ids);
          } else if (method === 'POST') {
            const at = _.isNil(body.position) ? spotify.playlist.length : body.position;
            spotify.playlist.splice(at, 0, ...ids);
          } else {
            spotify.playlist = _.difference(spotify.playlist, ids);
          }
          return {};
        },
        get: async () => ({ name: 'Mix', snapshot_id: spotify.playlist.join(',') }),
        paginate: async url =>
          url.startsWith('/me/tracks')
            ? items(spotify.liked, 'track')
            : items(spotify.playlist, 'item')
      };
    };

    beforeEach(() => {
      spotify = { liked: ['a'], playlist: ['x', 'y', 'z'] };
      config.sync = { playlists: [{ filter: 'rating:5', playlist: playlistId }] };
    });

    it('should reverse a push: remove what it added and put back what it removed in place', async () => {
      const client = fakeClient();
      begin('push', 'sync');
      recordSpotifySnapshot((await saveSnapshot(client, config)).file);
      await pushPlan(client, [
        { id: 'liked', name: 'Liked Songs', add: [{ trackId: 'b' }] },
        { id: playlistId, name: 'Mix', add: [{ trackId: 'w' }], reject: [{ track_id: 'y' }] }
      ]);
      endJournal();
      expect(spotify).to.deep.equal({ liked: ['a', 'b'], playlist: ['x', 'z', 'w'] });
      expect(run('push')).to.include({ spotify: 3 });
      db.prepare("INSERT INTO spotify_synced (playlist_id, track_id) VALUES ('liked', 'b')").run();

      begin('undo', 'undo');
      const { spotify: result } = await applyUndo({
        db,
        config,
        client,
        plan: planUndo(db, run('push'))
      });
      endJournal();
      expect(spotify).to.deep.equal({ liked: ['a'], playlist: ['x', 'y', 'z'] });
      expect(_.map(result.removed, 'trackId').sort()).to.deep.equal(['b', 'w']);
      expect(_.map(result.added, 'trackId')).to.deep.equal(['y']);
      expect(fs.existsSync(result.snapshot)).to.be.true;
      // the undo is a local change to the next sync, not one made on Spotify
      expect(
        db
          .prepare('SELECT playlist_id, track_id FROM spotify_synced ORDER BY 1, 2')
          .all()
          .map(({ playlist_id: id, track_id: track }) => `${id}:${track}`)
      ).to.deep.equal([`${playlistId}:y`]);
      expect(run('undo')).to.include({ undoes: 'push', spotify: 3 });
    });

    it('should leave tracks alone that are already as they were before the run', async () => {
      const client = fakeClient();
      begin('push', 'sync');
      await pushPlan(client, [{ id: 'liked', name: 'Liked Songs', add: [{ trackId: 'b' }] }]);
      endJournal();
      spotify.liked = ['a'];
      const { spotify: result } = await applyUndo({
        db,
        config,
        client,
        plan: planUndo(db, run('push'))
      });
      expect(result.removed).to.be.empty;
      expect(result.skipped).to.deep.equal([{ targetName: 'Liked Songs', trackId: 'b' }]);
    });
  });
});
