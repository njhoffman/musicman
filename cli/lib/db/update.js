const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');
const { escape, globSync } = require('glob');

const { readMetadataFull, parseMetadata } = require('../metadata/read.js');
const { isPopulated } = require('../metadata/tags.js');
const { setMeta, transaction } = require('./database.js');

const mbTrackIdFrame = 'TXXX.MusicBrainz Release Track Id';

// files read and written per transaction
const batchSize = 200;

// mp3 files at target (a file or a directory, recursively), sorted by path
const listFiles = target => {
  if (fs.statSync(target).isFile()) {
    return [target];
  }
  return globSync(`${escape(target)}/**/*.mp3`).sort();
};

const toValue = value => {
  if (_.isString(value)) {
    return value;
  }
  return value === true ? '1' : JSON.stringify(value);
};

const splitMulti = value =>
  _.uniq(
    value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  );

/**
 * [frame_id, value] rows for every populated frame in raw tags. Custom fields are identified by
 * description (TXXX.<description>), multi value frames get one row per value.
 */
const frameRows = (rawTags, multiFrames) => {
  const rows = _.flatMap(_.omit(rawTags, ['duration', 'size']), (value, id) => {
    if (id === 'TXXX') {
      return _.flatMap([].concat(value), field => {
        const frameId = `TXXX.${field.description}`;
        if (!isPopulated(field.value)) {
          return [];
        }
        const text = `${field.value}`;
        return (multiFrames.has(frameId) ? splitMulti(text) : [text]).map(item => [frameId, item]);
      });
    }
    if (!isPopulated(value)) {
      return [];
    }
    if (_.isString(value) && multiFrames.has(id)) {
      return splitMulti(value).map(item => [id, item]);
    }
    return [].concat(value).map(item => [id, toValue(item)]);
  });
  return _.uniqBy(rows, ([frameId, value]) => `${frameId}\u0000${value}`);
};

// escape LIKE wildcards in a path prefix
const likePrefix = prefix => `${prefix.replace(/[\\%_]/g, char => `\\${char}`)}/%`;

/**
 * Updates the database from the mp3 files at target, which must be inside mpd.baseDirectory.
 * Files with unchanged mtime and size are skipped; a new file with the MusicBrainz track id of a
 * song whose file no longer exists is treated as that song moved; songs whose files are gone from
 * the scanned scope are removed.
 */
const updateDatabase = async (
  db,
  {
    config,
    target,
    files: fileList,
    record = true,
    onProgress = _.noop,
    onFile = _.noop,
    concurrency = 5
  }
) => {
  const startedAt = Date.now();
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const relativePath = file => path.relative(baseDirectory, path.resolve(file));
  const isOutside = relative => relative.startsWith('..') || path.isAbsolute(relative);

  // an explicit file list updates only those songs, a target updates and prunes its whole scope
  const scope = fileList ? null : relativePath(target);
  if (scope !== null && isOutside(scope)) {
    throw new Error(`Target ${target} is not inside mpd.baseDirectory ${baseDirectory}`);
  }
  const outside = fileList ? _.filter(fileList, file => isOutside(relativePath(file))) : [];
  if (outside.length > 0) {
    throw new Error(
      `Files are not inside mpd.baseDirectory ${baseDirectory}: ${outside.join(', ')}`
    );
  }

  const listed = fileList
    ? [].concat(fileList).map(file => path.resolve(file))
    : listFiles(path.resolve(target));
  const files = await Promise.map(listed, async file => {
    const { mtimeMs, size } = await fs.promises.stat(file);
    return { file, path: relativePath(file), mtime: Math.floor(mtimeMs), size };
  });

  const selectSongs = 'SELECT id, path, mtime, size FROM songs';
  let scopeRows;
  if (fileList) {
    const selectPath = db.prepare(`${selectSongs} WHERE path = ?`);
    scopeRows = _.compact(_.map(files, file => selectPath.get(file.path)));
  } else if (scope) {
    scopeRows = db
      .prepare(`${selectSongs} WHERE path = ? OR path LIKE ? ESCAPE '\\'`)
      .all(scope, likePrefix(scope));
  } else {
    scopeRows = db.prepare(selectSongs).all();
  }
  const rowsByPath = _.keyBy(scopeRows, 'path');
  const seen = new Set(_.map(files, 'path'));

  const unchanged = _.filter(files, f => {
    const row = rowsByPath[f.path];
    return row && row.mtime === f.mtime && row.size === f.size;
  });
  const toRead = _.difference(files, unchanged);
  const multiFrames = new Set(
    _.map(db.prepare('SELECT frame_id FROM tags WHERE multi = 1').all(), 'frame_id')
  );

  const statements = {
    insertSong: db.prepare(
      'INSERT INTO songs (path, mb_track_id, mtime, size, duration, rating) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    updateSong: db.prepare(
      `UPDATE songs SET path = ?, mb_track_id = ?, mtime = ?, size = ?, duration = ?, rating = ?,
       updated_at = datetime('now') WHERE id = ?`
    ),
    movedSongs: db.prepare('SELECT id, path FROM songs WHERE mb_track_id = ?'),
    deleteTags: db.prepare('DELETE FROM song_tags WHERE song_id = ?'),
    insertTag: db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)'),
    deleteSong: db.prepare('DELETE FROM songs WHERE id = ?')
  };

  const counts = {
    scanned: files.length,
    unchanged: unchanged.length,
    added: 0,
    updated: 0,
    moved: 0,
    removed: 0,
    failed: 0
  };
  const relinked = new Set();

  // a song whose stored file no longer exists, with the same MusicBrainz track id
  const findMoved = mbTrackId =>
    _.find(
      statements.movedSongs.all(mbTrackId),
      row =>
        !seen.has(row.path) &&
        !relinked.has(row.id) &&
        !fs.existsSync(path.join(baseDirectory, row.path))
    );

  const writeSong = ({ file, rawTags }) => {
    const rows = frameRows(rawTags, multiFrames);
    const mbTrackId = _.get(
      _.find(rows, ([frameId]) => frameId === mbTrackIdFrame),
      1,
      null
    );
    const { rating } = parseMetadata(rawTags, config);
    const values = [
      file.path,
      mbTrackId,
      file.mtime,
      file.size,
      rawTags.duration || null,
      rating ? Number(rating) : null
    ];

    const existing = rowsByPath[file.path];
    const moved = !existing && mbTrackId ? findMoved(mbTrackId) : null;
    let songId;
    let action;
    if (existing) {
      statements.updateSong.run(...values, existing.id);
      songId = existing.id;
      action = 'updated';
    } else if (moved) {
      statements.updateSong.run(...values, moved.id);
      relinked.add(moved.id);
      songId = moved.id;
      action = 'moved';
    } else {
      songId = Number(statements.insertSong.run(...values).lastInsertRowid);
      action = 'added';
    }
    statements.deleteTags.run(songId);
    rows.forEach(([frameId, value]) => statements.insertTag.run(songId, frameId, value));
    counts[action] += 1;
    onFile(action, file.path, moved ? moved.path : null);
  };

  let done = 0;
  // raw tags for a file, or null when it cannot be read
  const readFile = async file => {
    try {
      return { file, rawTags: await readMetadataFull(file.file) };
    } catch (err) {
      counts.failed += 1;
      onFile('failed', file.path, err.message);
      return null;
    } finally {
      done += 1;
      onProgress({ done, total: toRead.length, ...counts });
    }
  };

  // read each batch concurrently, then write it in one transaction
  await Promise.each(_.chunk(toRead, batchSize), async batch => {
    const results = await Promise.map(batch, readFile, { concurrency });
    transaction(db, () => _.compact(results).forEach(writeSong));
  });

  // songs in scope whose files were not found and were not moved
  const removed = _.filter(scopeRows, row => !seen.has(row.path) && !relinked.has(row.id));
  transaction(db, () =>
    removed.forEach(row => {
      statements.deleteSong.run(row.id);
      counts.removed += 1;
      onFile('removed', row.path);
    })
  );

  const summary = {
    ...counts,
    target: fileList ? `${files.length} files` : scope || '.',
    seconds: (Date.now() - startedAt) / 1000
  };
  if (record) {
    setMeta(db, 'lastUpdate', { at: new Date().toISOString(), ...summary });
  }
  return summary;
};

module.exports = { frameRows, updateDatabase };
