const _ = require('lodash');
const path = require('path');
const { execFile } = require('child_process');
const Promise = require('bluebird');

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
 * grouping beets has a path rule for. Each is marked with whether beets already has it (update and
 * move) or not (import as a singleton).
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
      `SELECT s.path, s.rating, t.value AS grouping FROM songs s
       JOIN song_tags t ON t.song_id = s.id AND t.frame_id = 'TIT1'
       WHERE s.path LIKE ? AND s.rating IS NOT NULL`
    )
    .all(`${folder}/%`);
  return _.map(
    _.filter(rows, ({ grouping }) => groupings.has(grouping)),
    ({ path: songPath, rating, grouping }) => {
      const file = path.join(baseDirectory, songPath);
      return {
        file,
        path: songPath,
        rating,
        grouping,
        action: beetsItems.has(file) ? 'move' : 'import'
      };
    }
  );
};

/**
 * Has beets move each candidate to its sorted folder: beet update -m re-reads the tags of songs beets
 * has and moves them, beet import -s -q -A imports the others as singletons without changing their tags.
 */
const sortSongs = async (candidates, { beetsConfig, runBeet = execBeet, onSong = _.noop } = {}) => {
  const configArgs = beetsConfig ? ['-c', beetsConfig] : [];
  const results = await Promise.mapSeries(candidates, async candidate => {
    const args =
      candidate.action === 'move'
        ? [...configArgs, 'update', '-m', `path:${candidate.file}`]
        : [...configArgs, 'import', '-s', '-q', '-A', candidate.file];
    try {
      await runBeet(args);
      onSong('sorted', candidate);
      return { ...candidate, status: 'sorted' };
    } catch (err) {
      onSong('failed', candidate, err.message);
      return { ...candidate, status: 'failed', error: err.message };
    }
  });
  return {
    sorted: _.filter(results, { status: 'sorted' }).length,
    failed: _.filter(results, { status: 'failed' }).length,
    results
  };
};

module.exports = { execBeet, sortCandidates, sortSongs, sortedGroupings, unsortedFolder };
