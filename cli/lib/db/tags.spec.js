const { expect } = require('chai');
const { openDatabase } = require('./database.js');
const { syncTagDefinitions, tagDefinitions } = require('./tags.js');

describe('Database Tag Definitions', () => {
  let db;
  const config = {
    tags: [
      { id: 'TPE1', name: 'artist' },
      { id: 'TYER', name: 'year' },
      { id: 'TXXX.Mood', name: 'mood', multi: true }
    ]
  };
  const rows = () => db.prepare('SELECT name, frame_id, multi, source FROM tags').all();
  const row = name => rows().find(tag => tag.name === name);

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should prefer config definitions over tags.json entries with the same name', () => {
    const definitions = tagDefinitions(config);
    expect(definitions.find(tag => tag.name === 'year')).to.deep.equal({
      name: 'year',
      frame_id: 'TYER',
      multi: 0,
      source: 'config'
    });
    expect(definitions.filter(tag => tag.name === 'year')).to.have.length(1);
    expect(definitions.find(tag => tag.name === 'album')).to.include({
      frame_id: 'TALB',
      source: 'tags.json'
    });
  });

  it('should insert config and tags.json definitions', () => {
    const result = syncTagDefinitions(db, config);
    expect(result.errors).to.be.empty;
    expect(row('mood')).to.deep.equal({
      name: 'mood',
      frame_id: 'TXXX.Mood',
      multi: 1,
      source: 'config'
    });
    expect(row('album')).to.include({ frame_id: 'TALB', source: 'tags.json' });
  });

  it('should not change anything when definitions are unchanged', () => {
    syncTagDefinitions(db, config);
    expect(syncTagDefinitions(db, config)).to.deep.equal({ errors: [], inserted: 0, updated: 0 });
  });

  it('should keep stored definitions that were removed from the config', () => {
    syncTagDefinitions(db, config);
    syncTagDefinitions(db, { tags: [{ id: 'TPE1', name: 'artist' }] });
    expect(row('mood')).to.include({ frame_id: 'TXXX.Mood', source: 'config' });
  });

  it('should update changed standard frame definitions', () => {
    syncTagDefinitions(db, { tags: [{ id: 'TDRL', name: 'year' }] });
    const result = syncTagDefinitions(db, config);
    expect(result.errors).to.be.empty;
    expect(row('year')).to.include({ frame_id: 'TYER' });
  });

  it('should return an error and write nothing when a custom field frame changes', () => {
    syncTagDefinitions(db, config);
    const changed = {
      tags: [
        { id: 'TPE1', name: 'artist' },
        { id: 'TXXX.Feeling', name: 'mood', multi: true },
        { id: 'TCOM', name: 'composer2' }
      ]
    };
    const result = syncTagDefinitions(db, changed);
    expect(result.errors).to.deep.equal([
      'Custom field mood (TXXX.Mood, multi) is stored in the database but is now defined as mood (TXXX.Feeling, multi)'
    ]);
    expect(row('mood')).to.include({ frame_id: 'TXXX.Mood' });
    expect(row('composer2')).to.be.undefined;
  });

  it('should return an error when a custom field changes between single and multi value', () => {
    syncTagDefinitions(db, config);
    const result = syncTagDefinitions(db, { tags: [{ id: 'TXXX.Mood', name: 'mood' }] });
    expect(result.errors[0]).to.include('is now defined as mood (TXXX.Mood)');
  });

  it('should return an error when a custom field is renamed', () => {
    syncTagDefinitions(db, config);
    const result = syncTagDefinitions(db, {
      tags: [{ id: 'TXXX.Mood', name: 'feeling', multi: true }]
    });
    expect(result.errors).to.deep.equal([
      "Custom field mood (TXXX.Mood, multi) is stored in the database but is now named 'feeling'"
    ]);
  });
});
