const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { expect } = require('chai');

const { readBeetsConfig, readBeetsSpotifyIds } = require('./beets.js');

describe('Beets Spotify Ids', () => {
  let directory;
  let configPath;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-beets-'));
    configPath = path.join(directory, 'config.yaml');
    fs.writeFileSync(
      configPath,
      `directory: ${directory}/music\nlibrary: ${directory}/library.db\n`
    );
    const db = new DatabaseSync(path.join(directory, 'library.db'));
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY, path BLOB);
      CREATE TABLE item_attributes (id INTEGER PRIMARY KEY, entity_id INTEGER, key TEXT, value TEXT);
    `);
    db.prepare('INSERT INTO items (id, path) VALUES (?, ?)').run(1, Buffer.from('Rated/a.mp3'));
    db.prepare('INSERT INTO items (id, path) VALUES (?, ?)').run(2, Buffer.from('/abs/b.mp3'));
    db.prepare('INSERT INTO items (id, path) VALUES (?, ?)').run(3, Buffer.from('Rated/c.mp3'));
    const attribute = db.prepare(
      'INSERT INTO item_attributes (entity_id, key, value) VALUES (?, ?, ?)'
    );
    attribute.run(1, 'spotify_track_id', 'id-a');
    attribute.run(2, 'spotify_track_id', 'id-b');
    attribute.run(3, 'spotify_energy', '0.5');
    db.close();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should read the library and music directory from the beets config', () => {
    expect(readBeetsConfig(configPath)).to.deep.equal({
      library: path.join(directory, 'library.db'),
      directory: path.join(directory, 'music')
    });
  });

  it('should map beets items with a Spotify track id to absolute paths', () => {
    expect([...readBeetsSpotifyIds(configPath)]).to.deep.equal([
      [path.join(directory, 'music', 'Rated/a.mp3'), 'id-a'],
      ['/abs/b.mp3', 'id-b']
    ]);
  });

  it('should return no ids without a beets config', () => {
    expect(readBeetsSpotifyIds(path.join(directory, 'missing.yaml')).size).to.equal(0);
  });
});
