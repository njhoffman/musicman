const { expect } = require('chai');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { backButton, reshuffleSource } = require('./menu.js');
const { openLibrary } = require('../db/index.js');
const { setMeta } = require('../db/database.js');
const { backKey } = require('../player/back.js');

describe('Menu reshuffle source', () => {
  const track = { trackId: 't1' };
  const lastSource = { terms: ['rating:4.5'], name: 'rating:4.5' };
  const pick = (context, extra = {}) =>
    reshuffleSource({
      track,
      contextOf: async () => context,
      lastSource,
      shufflePlaylistId: 'shuffleid',
      ...extra
    });

  it('should shuffle the playlist that is playing', async () => {
    expect(
      await pick({ type: 'playlist', name: 'Study', uri: 'spotify:playlist:study1' })
    ).to.deep.equal({ name: 'Study', terms: ['spotify:playlist:study1'] });
  });

  it('should shuffle Liked Songs when they are playing', async () => {
    expect(
      await pick({ type: 'collection', name: 'Liked Songs', uri: 'spotify:user:me:collection' })
    ).to.deep.equal({ name: 'Liked Songs', terms: ['liked'] });
  });

  it('should fall back to the last source for the shuffle playlist, albums, track lists, and errors', async () => {
    const fallback = { name: 'rating:4.5', terms: ['rating:4.5'] };
    expect(
      await pick({ type: 'playlist', name: 'musicman shuffle', uri: 'spotify:playlist:shuffleid' })
    ).to.deep.equal(fallback);
    expect(await pick({ type: 'album', name: 'X', uri: 'spotify:album:x' })).to.deep.equal(
      fallback
    );
    expect(await pick(null)).to.deep.equal(fallback);
    expect(
      await reshuffleSource({
        track,
        contextOf: async () => {
          throw new Error('offline');
        },
        lastSource,
        shufflePlaylistId: null
      })
    ).to.deep.equal(fallback);
  });

  it('should offer nothing without a context or a last source', async () => {
    expect(await pick(null, { lastSource: null })).to.equal(null);
  });
});

describe('Menu back button', () => {
  let dir;
  let config;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-menu-back-'));
    config = {
      mpd: { baseDirectory: dir },
      db: { path: path.join(dir, 'musicman.sqlite'), backupDirectory: dir },
      library: { tags: [] },
      tags: []
    };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('should name the song of the back point, nothing without one or a database', async () => {
    expect(await backButton(config).point()).to.equal(null);
    const db = openLibrary(config);
    expect(await backButton(config).point()).to.equal(null);
    setMeta(db, backKey, { source: 'mpd', track: { artist: 'Band', title: 'Main' } });
    expect(await backButton(config).point()).to.equal('Band - Main');
    setMeta(db, backKey, { source: 'mpd', track: {} });
    expect(await backButton(config).point()).to.equal('the last playback');
    db.close();
  });

  it('should go back through the player command', async () => {
    const calls = [];
    await backButton(config, { X: 1 }, { player: async args => calls.push(args) }).run();
    expect(calls).to.deep.equal([
      { options: { terms: ['back'], switches: {} }, config, env: { X: 1 } }
    ]);
  });
});
