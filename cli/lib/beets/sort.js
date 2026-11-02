const _ = require('lodash');
const path = require('path');
const { execFile } = require('child_process');
const { mapLimit } = require('../utils/promise.js');
const { rewriteTags } = require('../metadata/write.js');
const { updateDatabase } = require('../db/update.js');
const { readBeetsConfig, readBeetsItems } = require('../spotify/beets.js');

// where sync --import keeps the grouping of a download's Spotify playlist until the song is rated:
// written to TIT1 right away, it would make beets file the unrated download under Rated
const groupingHintFrame = 'TXXX.playlist_grouping';

// run beet with arguments, resolving with its output or rejecting with its error output
const execBeet = (args, { command = 'beet' } = {}) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err
        ? reject(new Error(`${command} ${args[0]} failed: ${(stderr || err.message).trim()}`))
        : resolve(stdout)
    );
  });

// folder beets imports unsorted songs into, the first segment of its default path (e.g. Unrated)
const unsortedFolder = beets => `${_.get(beets, 'paths.default', '')}`.split('/')[0] || null;

// grouping values beets has a path rule for (paths: grouping:IndieRock.Artists: Rated/...)
const sortedGroupings = beets =>
  new Set(
    _.compact(
      _.map(_.keys(_.get(beets, 'paths', {})), key =>
        key.startsWith('grouping:') ? key.slice(9) : null
      )
    )
  );

/**
 * Songs beets would move out of its unsorted folder: stored under that folder with a rating and a
 * grouping beets has a path rule for. A song without a grouping uses the grouping hint sync --import
 * left (groupingHintFrame), marked fromHint. Each is marked with whether beets already has it (update
 * and move) or not (import as a singleton).
 */
const sortCandidates = (db, { config, beets, beetsItems }) => {
  const folder = unsortedFolder(beets);
  const groupings = sortedGroupings(beets);
  if (!folder || groupings.size === 0) {
    return [];
  }
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const rows = db
    .prepare(
      `SELECT s.path, s.rating, t.value AS grouping, h.value AS hint FROM songs s
       LEFT JOIN song_tags t ON t.song_id = s.id AND t.frame_id = 'TIT1'
       LEFT JOIN song_tags h ON h.song_id = s.id AND h.frame_id = ?
       WHERE s.path LIKE ? AND s.rating IS NOT NULL`
    )
    .all(groupingHintFrame, `${folder}/%`);
  return _.compact(
    _.map(rows, ({ path: songPath, rating, grouping, hint }) => {
      const fromHint = !grouping && Boolean(hint);
      const value = grouping || hint;
      if (!groupings.has(value)) {
        return null;
      }
      const file = path.join(baseDirectory, songPath);
      return {
        file,
        path: songPath,
        rating,
        grouping: value,
        fromHint,
        action: beetsItems.has(file) ? 'move' : 'import'
      };
    })
  );
};

// writes a hinted grouping to TIT1 and removes the hint (through rewriteTags: other frames are kept,
// and the change is recorded for musicman undo)
const applyGroupingHint = (file, grouping) => {
  const description = groupingHintFrame.slice(5);
  const result = rewriteTags(file, raw => {
    const txxx = _.reject([].concat(raw.TXXX || []), { description });
    const tags = { ...raw, TIT1: grouping, TXXX: txxx };
    if (txxx.length === 0) {
      delete tags.TXXX;
    }
    return tags;
  });
  if (result instanceof Error) {
    throw result;
  }
};

/**
 * Has beets move each candidate to its sorted folder: beet update -m re-reads the tags of songs beets
 * has and moves them, beet import -s -q -A imports the others as singletons without changing their tags.
 * A candidate fromHint first gets its hinted grouping written to TIT1 (writeGrouping).
 */
const sortSongs = async (
  candidates,
  { beetsConfig, runBeet = execBeet, writeGrouping = applyGroupingHint, onSong = _.noop } = {}
) => {
  const configArgs = beetsConfig ? ['-c', beetsConfig] : [];
  const results = await mapLimit(
    candidates,
    async candidate => {
      const args =
        candidate.action === 'move'
          ? [...configArgs, 'update', '-m', `path:${candidate.file}`]
          : [...configArgs, 'import', '-s', '-q', '-A', candidate.file];
      try {
        if (candidate.fromHint) {
          writeGrouping(candidate.file, candidate.grouping);
        }
        await runBeet(args);
        onSong('sorted', candidate);
        return { ...candidate, status: 'sorted' };
      } catch (err) {
        onSong('failed', candidate, err.message);
        return { ...candidate, status: 'failed', error: err.message };
      }
    },
    1
  );
  return {
    sorted: _.filter(results, { status: 'sorted' }).length,
    failed: _.filter(results, { status: 'failed' }).length,
    results
  };
};

// the Spotify track id stored for a song path, which finds the song again after beets moves it
const trackIdAt = (db, songPath) =>
  _.get(
    db
      .prepare(
        `SELECT t.value FROM songs s JOIN song_tags t ON t.song_id = s.id
         WHERE s.path = ? AND t.frame_id = 'TXXX.sp_track_id'`
      )
      .get(songPath),
    'value',
    null
  );

// where a song is after the move: the newest other path holding its Spotify track id, else null
const pathOfTrack = (db, trackId, oldPath) =>
  trackId
    ? _.get(
        db
          .prepare(
            `SELECT s.path FROM songs s JOIN song_tags t ON t.song_id = s.id
             WHERE t.frame_id = 'TXXX.sp_track_id' AND t.value = ? AND s.path != ?
             ORDER BY s.id DESC`
          )
          .get(trackId, oldPath),
        'path',
        null
      )
    : null;

/**
 * Sorts the files among files that are ready to leave the unsorted folder (sortCandidates) right away,
 * as edit and the menu do once a change gives a song its rating and grouping: beets moves them, the
 * database is updated, and each is reported as { from, to, grouping, fromHint, status, error } with to
 * its new path (found by Spotify track id, null without one). Files not ready are left alone; without a
 * beets config nothing happens. Resolves to [] when nothing was ready.
 */
const sortReady = async ({
  db,
  config,
  files,
  runBeet = execBeet,
  readBeets = readBeetsConfig,
  readItems = readBeetsItems,
  update = updateDatabase
}) => {
  const beets = readBeets(_.get(config, 'sync.beetsConfig'));
  if (!beets) {
    return [];
  }
  const wanted = new Set(_.map(files, file => path.resolve(file)));
  const candidates = _.filter(
    sortCandidates(db, { config, beets, beetsItems: readItems(beets) }),
    ({ file }) => wanted.has(file)
  );
  if (candidates.length === 0) {
    return [];
  }
  const trackIds = new Map(
    _.map(candidates, ({ path: songPath }) => [songPath, trackIdAt(db, songPath)])
  );
  const { results } = await sortSongs(candidates, {
    beetsConfig: _.get(config, 'sync.beetsConfig'),
    runBeet
  });
  await update(db, { config, target: config.mpd.baseDirectory });
  return _.map(results, ({ path: songPath, grouping, fromHint, status, error }) => ({
    from: songPath,
    to: status === 'sorted' ? pathOfTrack(db, trackIds.get(songPath), songPath) : null,
    grouping,
    fromHint,
    status,
    error: error || null
  }));
};

/**
 * Songs in the unsorted folder that sort cannot move yet, with what each is missing: a rating, and a
 * grouping beets has a path rule for (hint: the grouping hint it would use once rated). Sorted by path.
 */
const waitingSongs = (db, { beets }) => {
  const folder = unsortedFolder(beets);
  const groupings = sortedGroupings(beets);
  if (!folder) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT s.path, s.rating, t.value AS grouping, h.value AS hint FROM songs s
       LEFT JOIN song_tags t ON t.song_id = s.id AND t.frame_id = 'TIT1'
       LEFT JOIN song_tags h ON h.song_id = s.id AND h.frame_id = ?
       WHERE s.path LIKE ? ORDER BY s.path`
    )
    .all(groupingHintFrame, `${folder}/%`);
  return _.compact(
    _.map(rows, ({ path: songPath, rating, grouping, hint }) => {
      const sortable = groupings.has(grouping || hint);
      const missing = _.compact([
        rating === null || rating === undefined ? 'rating' : null,
        sortable ? null : 'grouping'
      ]);
      return missing.length
        ? { path: songPath, missing, grouping: grouping || null, hint: hint || null }
        : null;
    })
  );
};

module.exports = {
  execBeet,
  groupingHintFrame,
  sortCandidates,
  sortReady,
  sortSongs,
  sortedGroupings,
  waitingSongs,
  unsortedFolder
};
