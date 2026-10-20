const _ = require('lodash');
const fs = require('fs');
const path = require('path');

// stored text frames are plain strings, other frames are JSON (cover art is a '1' marker)
const toRawValue = (frameId, value) => {
  if (/^T/.test(frameId)) {
    return value;
  }
  if (frameId === 'APIC') {
    return true;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return value;
  }
};

/**
 * Raw tags in the shape node-id3 reads them, from a song row and its song_tags rows.
 * Multi value fields stored as one row per value are joined with commas.
 */
const toRawTags = (song, tagRows) => {
  const rawTags = {};
  const custom = {};
  _.each(tagRows, ({ frame_id: frameId, value }) => {
    if (frameId.startsWith('TXXX.')) {
      const description = frameId.slice('TXXX.'.length);
      custom[description] = (custom[description] || []).concat(value);
    } else if (/^T/.test(frameId)) {
      rawTags[frameId] = _.has(rawTags, frameId) ? `${rawTags[frameId]},${value}` : value;
    } else {
      const rawValue = toRawValue(frameId, value);
      rawTags[frameId] = _.has(rawTags, frameId) ? [].concat(rawTags[frameId], rawValue) : rawValue;
    }
  });
  if (!_.isEmpty(custom)) {
    rawTags.TXXX = _.map(custom, (values, description) => ({
      description,
      value: values.join(',')
    }));
  }
  if (song.duration !== null) {
    rawTags.duration = song.duration;
  }
  rawTags.size = song.size;
  return rawTags;
};

/**
 * Raw tags from the database for files inside mpd.baseDirectory, as [file, rawTags] in file order.
 * Files missing from the database or changed since it was updated (mtime or size) are returned as
 * stale so they can be read from disk. With onlyPaths (relative paths), unchanged stored files not in
 * it are skipped; stale files are always returned so callers can check them.
 */
const readStoredMetadata = (db, { config, files, onlyPaths = null }) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const songs = new Map(
    _.map(db.prepare('SELECT id, path, mtime, size, duration FROM songs').all(), song => [
      song.path,
      song
    ])
  );
  const selectTags = db.prepare(
    'SELECT frame_id, value FROM song_tags WHERE song_id = ? ORDER BY rowid'
  );

  const stored = [];
  const stale = [];
  _.each(files, file => {
    const relative = path.relative(baseDirectory, path.resolve(file));
    const song = songs.get(relative);
    const stat = song && fs.statSync(file);
    if (!song || song.mtime !== Math.floor(stat.mtimeMs) || song.size !== stat.size) {
      stale.push(file);
    } else if (!onlyPaths || onlyPaths.has(relative)) {
      stored.push([file, toRawTags(song, selectTags.all(song.id))]);
    }
  });
  return { stored, stale };
};

module.exports = { readStoredMetadata, toRawTags };
