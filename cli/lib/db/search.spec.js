const { expect } = require('chai');
const { openDatabase } = require('./database.js');
const { matchingPaths } = require('./search.js');

describe('Database Search Prefilter', () => {
  let db;
  const config = {
    library: {
      tags: [
        { id: 'TPE1', name: 'artist' },
        { id: 'TIT2', name: 'title' },
        { id: 'TXXX.Mood', name: 'mood', multi: true }
      ]
    }
  };
  const songs = {
    'a.mp3': {
      rating: 5,
      tags: [
        ['TPE1', 'The Doors'],
        ['TIT2', 'Strange Days'],
        ['TXXX.Mood', 'Mellow']
      ]
    },
    'b.mp3': {
      rating: 4,
      tags: [
        ['TPE1', 'Björk'],
        ['TIT2', 'Army of Me'],
        ['TXXX.Mood', 'Intense']
      ]
    },
    'c.mp3': {
      rating: null,
      tags: [
        ['TPE1', 'Nas'],
        ['TIT2', 'N.Y. State of Mind']
      ]
    }
  };
  const match = (filters, words = []) => {
    const paths = matchingPaths(db, { config, filters, words });
    return paths && [...paths].sort();
  };

  beforeEach(() => {
    db = openDatabase(':memory:');
    const insertSong = db.prepare(
      'INSERT INTO songs (path, mtime, size, rating) VALUES (?, 1, 1, ?)'
    );
    const insertTag = db.prepare(
      'INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)'
    );
    Object.entries(songs).forEach(([file, { rating, tags }]) => {
      const { lastInsertRowid } = insertSong.run(file, rating);
      tags.forEach(([frameId, value]) => insertTag.run(lastInsertRowid, frameId, value));
    });
  });

  afterEach(() => {
    db.close();
  });

  it('should return null when nothing narrows the search', () => {
    expect(match({ include: {}, exclude: { artist: 'Nas' }, rating: { min: null, max: null } })).to
      .be.null;
  });

  it('should match field substrings case-insensitively', () => {
    expect(match({ include: { artist: 'doors' } })).to.deep.equal(['a.mp3']);
  });

  it('should match multi value fields exactly', () => {
    expect(match({ include: { mood: ['mellow'] } })).to.deep.equal(['a.mp3']);
    expect(match({ include: { mood: ['Mell'] } })).to.deep.equal([]);
  });

  it('should match songs without a field for empty values', () => {
    expect(match({ include: { mood: '' } })).to.deep.equal(['c.mp3']);
  });

  it('should match rating ranges', () => {
    expect(match({ include: {}, rating: { min: '4.5', max: null } })).to.deep.equal(['a.mp3']);
    expect(match({ include: {}, rating: { min: '3', max: '4' } })).to.deep.equal(['b.mp3']);
  });

  it('should require every free text word in the artist or title', () => {
    expect(match({}, ['doors', 'strange'])).to.deep.equal(['a.mp3']);
    expect(match({}, ['doors', 'army'])).to.deep.equal([]);
  });

  it('should not narrow by values SQLite cannot match exactly', () => {
    expect(match({ include: { artist: 'björk' } })).to.be.null;
    expect(match({}, ['the doors'])).to.be.null;
    expect(match({ include: {}, rating: { min: '4', exclude: true } })).to.be.null;
  });

  it('should escape LIKE wildcards in values', () => {
    expect(match({ include: { title: 'N.Y.' } })).to.deep.equal(['c.mp3']);
    expect(match({ include: { title: '%' } })).to.deep.equal([]);
  });
});
