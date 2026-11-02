const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const NodeId3 = require('node-id3');

const { execBeet } = require('../beets/sort.js');
const { journaledMatch, recordFileMove } = require('../history/journal.js');
const { rewriteTags } = require('../metadata/write.js');
const { rejectReview, spotifyIdFrame } = require('../sync/match.js');

// release folders beets names after $albumtype, best first: an album copy wins over the others
const releaseRank = {
  album: 0,
  ep: 1,
  single: 2,
  compilation: 3,
  soundtrack: 3,
  remix: 4,
  live: 4
};

/**
 * Release type of a song from its path: songs in Singles folders (and the unsorted _Singles) are
 * singles, others are named by their release folder (album, ep, single, live, compilation, ...), album
 * when there is none (e.g. Unrated/<artist>/<album>/).
 */
const releaseType = songPath => {
  const folders = `${songPath}`.split('/').slice(0, -1);
  if (folders.some(folder => /^_?Singles$/.test(folder))) {
    return 'single';
  }
  const named = _.findLast(folders, folder => _.has(releaseRank, folder.toLowerCase()));
  return named ? named.toLowerCase() : 'album';
};

// a numbered copy beets or a download left next to the original: Song.1.mp3 next to Song.mp3
const numberedKey = songPath => `${songPath}`.replace(/\.\d+(\.mp3)$/i, '$1');
const isNumbered = songPath => numberedKey(songPath) !== songPath;

const unsorted = songPath => `${songPath}`.startsWith('Unrated/');

// version words in a file name that mark another recording of a song: Song (Arsenal mix).mp3
const versionWords = /\b(re-?mix|mix|edit|live|acoustic|demo|instrumental|unplugged|session|vocal)\b/i;
const versionOf = songPath => {
  const name = path.basename(`${songPath}`).replace(/\.mp3$/i, '');
  const qualifiers = name.match(/[([][^)\]]*[)\]]/g) || [];
  return _.find(qualifiers, qualifier => versionWords.test(qualifier)) || null;
};

/**
 * Why a copy is another recording than the song's other copies rather than a copy of it (a wrong
 * Spotify match): a live or remix release, or a version named in its title (radio edit, acoustic),
 * else null.
 */
const otherRecording = songPath => {
  const type = releaseType(songPath);
  if (type === 'live') {
    return 'live copy matched to the studio track';
  }
  if (type === 'remix') {
    return 'remix matched to the original track';
  }
  const version = versionOf(songPath);
  return version ? `${version} version matched to the original track` : null;
};

/**
 * What to do with one group of duplicates ({ path, mtime, rating }), by rules in order:
 *   another recording (a live or remix release, or a version like a radio edit in the title) next to
 *   the song is a wrong match, not a duplicate: its match is cleared (clear), the file kept
 *   a Rated copy wins over Unrated imports
 *   of numbered copies (Song.1.mp3 and Song.mp3 in one folder) the one without the number is kept,
 *   with the rating of the newer copy (mergedTags)
 *   an album copy wins over an EP, an EP over a single, a single over a compilation (releaseRank)
 * Returns { keep, remove, clear, candidates, reasons }: keep is null when copies tie (the same single in
 * two grouping folders), and candidates lists the copies to pick the one to keep from.
 */
const planGroup = files => {
  const reasons = {};
  const remove = [];
  const drop = (items, reason) =>
    _.each(items, item => {
      remove.push(item.path);
      reasons[item.path] = reason;
    });
  let members = files;
  const [others, originals] = _.partition(members, item => otherRecording(item.path));
  const clear = others.length > 0 && originals.length > 0 ? _.map(others, 'path') : [];
  _.each(clear, file => {
    reasons[file] = otherRecording(file);
  });
  if (clear.length > 0) {
    members = originals;
  }
  const [imports, rated] = _.partition(members, item => unsorted(item.path));
  if (imports.length > 0 && rated.length > 0) {
    drop(imports, 'Unrated import of a Rated song');
    members = rated;
  }
  _.each(
    _.filter(
      _.groupBy(members, item => numberedKey(item.path)),
      group => group.length > 1
    ),
    group => {
      // the file without the number keeps its name; the newer copy's rating reaches it (mergedTags)
      const original = _.find(group, item => !isNumbered(item.path)) || _.minBy(group, 'path');
      const copies = _.without(group, original);
      drop(copies, 'numbered copy');
      members = _.difference(members, copies);
    }
  );
  const rank = item => releaseRank[releaseType(item.path)];
  const best = _.min(_.map(members, rank));
  const [top, lower] = _.partition(members, item => rank(item) === best);
  _.each(lower, item =>
    drop([item], `${releaseType(item.path)} copy, the ${releaseType(top[0].path)} copy is kept`)
  );
  const keep = top.length === 1 ? top[0].path : null;
  return { keep, remove, clear, candidates: keep ? [] : _.map(top, 'path'), reasons };
};

// file groups that share a file joined into one (a song duplicated by Spotify id and by MusicBrainz
// id), so no file is kept by one group and removed by another
const joinOverlapping = fileGroups => {
  const joined = [];
  _.each(fileGroups, files => {
    const touching = _.filter(joined, group => _.some(files, file => group.has(file)));
    const group = new Set([...files, ..._.flatMap(touching, other => [...other])]);
    _.pull(joined, ...touching);
    joined.push(group);
  });
  return _.map(joined, group => [...group].sort());
};

/**
 * The duplicates findings of check (groups of files, overlapping ones joined) with the song rows the
 * plan needs: { files: [{ id, path, mtime, rating, trackId }] }.
 */
const duplicateGroups = (db, findings) => {
  const select = db.prepare('SELECT id, path, mtime, rating FROM songs WHERE path = ?');
  const trackOf = db.prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ?');
  return _.compact(
    _.map(joinOverlapping(_.map(findings, 'files')), files => {
      const rows = _.compact(_.map(files, file => select.get(file)));
      if (rows.length < 2) {
        return null;
      }
      return {
        files: _.map(rows, row => ({
          ...row,
          trackId: _.get(trackOf.get(row.id, spotifyIdFrame), 'value') || null
        }))
      };
    })
  );
};

/**
 * Plans every group: { groups: [{ files, keep, remove, clear, candidates, reasons }] }, groups with
 * nothing to do left out.
 */
const planDuplicates = groups =>
  _.filter(
    _.map(groups, group => ({ ...group, ...planGroup(group.files) })),
    ({ remove, clear, candidates }) => remove.length + clear.length + candidates.length > 0
  );

// a group after the copy to keep was picked among its candidates (the others are removed)
const resolveGroup = (group, keep) => {
  if (!keep) {
    return group;
  }
  const others = _.without(group.candidates, keep);
  return {
    ...group,
    keep,
    candidates: [],
    remove: [...group.remove, ...others],
    reasons: {
      ...group.reasons,
      ..._.fromPairs(_.map(others, file => [file, 'picked to remove']))
    }
  };
};

// where a removed copy goes: <db.backupDirectory>/trash/<run>/<path in the library>
const trashPath = (config, runId, songPath) =>
  path.join(
    _.get(config, 'db.backupDirectory') ||
      path.join(path.resolve(config.mpd.baseDirectory), '.musicman'),
    'trash',
    runId,
    songPath
  );

// multi value fields (library.tags with multi) as TXXX descriptions
const multiDescriptions = config =>
  _.compact(
    _.map(_.filter(_.get(config, 'library.tags', []), 'multi'), ({ id }) =>
      `${id}`.startsWith('TXXX.') ? `${id}`.slice(5) : null
    )
  );

const txxxValue = (raw, description) =>
  _.get(_.find([].concat(raw.TXXX || []), { description }), 'value', '');

const splitValues = value => _.compact(_.map(`${value || ''}`.split(','), _.trim));

/**
 * The kept copy's raw tags with the multi value fields of the removed copies merged in (each value
 * once, in any case), and the rating (POPM) of the newest copy that has one when it differs. Pure.
 */
const mergedTags = ({ keepRaw, keepMtime, others, descriptions }) => {
  const raw = _.cloneDeep(keepRaw);
  const changes = [];
  _.each(descriptions, description => {
    const current = splitValues(txxxValue(raw, description));
    const merged = _.uniqBy(
      [
        ...current,
        ..._.flatMap(others, ({ raw: other }) => splitValues(txxxValue(other, description)))
      ],
      _.toLower
    );
    if (merged.length > current.length) {
      raw.TXXX = [
        ..._.reject([].concat(raw.TXXX || []), { description }),
        { description, value: merged.join(',') }
      ];
      changes.push(`${description} +${_.difference(merged, current).join(',+')}`);
    }
  });
  const rated = _.filter(
    [{ raw: keepRaw, mtime: keepMtime }, ...others],
    ({ raw: tags }) => !_.isEmpty(tags.POPM)
  );
  const newest = _.maxBy(rated, 'mtime');
  if (newest && newest.raw !== keepRaw && !_.isEqual(newest.raw.POPM, keepRaw.POPM)) {
    raw.POPM = _.cloneDeep(newest.raw.POPM);
    changes.push('rating of the newer copy');
  }
  return { raw, changes };
};

const readRaw = file => _.get(NodeId3.read(file), 'raw', {}) || {};

// a rename, or a copy and delete when the trash is on another file system
const moveFile = (from, to) => {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') {
      throw err;
    }
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(from);
  }
};

/**
 * Applies resolved groups (keep picked, no candidates left): merges the removed copies' multi value
 * fields and newer rating into the kept copy, clears the Spotify match of live copies (their id is
 * rejected for them, so sync --match looks them up again), and moves removed copies to the trash
 * (trashPath) after taking them out of beets, recorded for musicman undo. Removed songs leave the
 * database. Resolves to { merged, cleared, removed, failed } (failed: [{ file, error }]).
 */
const applyDuplicates = async ({
  db,
  config,
  groups,
  runId,
  beet = execBeet,
  read = readRaw,
  write = rewriteTags,
  move = moveFile,
  onProgress = _.noop
}) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const absolute = songPath => path.join(baseDirectory, songPath);
  const descriptions = multiDescriptions(config);
  const result = { merged: [], cleared: [], removed: [], failed: [] };
  const deleteSong = db.prepare('DELETE FROM songs WHERE path = ?');
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const byPath = _.keyBy(group.files, 'path');
    if (group.keep && group.remove.length > 0) {
      try {
        const others = _.map(group.remove, file => ({
          raw: read(absolute(file)),
          mtime: byPath[file].mtime
        }));
        const keepRaw = read(absolute(group.keep));
        const { raw, changes } = mergedTags({
          keepRaw,
          keepMtime: byPath[group.keep].mtime,
          others,
          descriptions
        });
        if (changes.length > 0) {
          const written = write(absolute(group.keep), () => raw);
          if (written instanceof Error) {
            throw written;
          }
          result.merged.push({ file: group.keep, changes });
        }
      } catch (err) {
        // without the merge the copies are not removed, nothing they hold is lost
        result.failed.push({ file: group.keep, error: err.message });
        onProgress(i + 1, groups.length);
        continue;
      }
    }
    if (group.clear.length > 0) {
      const items = _.compact(
        _.map(group.clear, file =>
          byPath[file].trackId
            ? {
                songId: byPath[file].id,
                file: absolute(file),
                linked: true,
                candidate: { id: byPath[file].trackId }
              }
            : null
        )
      );
      // a song linked by its tags alone has no match row to hold the rejection
      const ensureRow = db.prepare(
        `INSERT INTO spotify_matches (song_id, status, track_id, source, checked_at)
         VALUES (?, 'match', ?, 'tags', datetime('now')) ON CONFLICT (song_id) DO NOTHING`
      );
      _.each(items, item =>
        journaledMatch(db, item.songId, () => ensureRow.run(item.songId, item.candidate.id))
      );
      const { rejected, failed } = await rejectReview({ db, config, items });
      result.cleared.push(..._.map(rejected, item => path.relative(baseDirectory, item.file)));
      result.failed.push(
        ..._.map(failed, item => ({
          file: path.relative(baseDirectory, item.file),
          error: item.error
        }))
      );
    }
    for (const file of group.remove) {
      try {
        const from = absolute(file);
        const to = trashPath(config, runId, file);
        if (fs.existsSync(to)) {
          throw new Error(`${to} already exists`);
        }
        const query = `path:${from}`;
        const inBeets = `${await beet(['ls', '-p', query])}`.trim().length > 0;
        if (inBeets) {
          await beet(['remove', '-f', query]);
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        move(from, to);
        recordFileMove({ action: 'trash', file: from, to, beets: inBeets });
        deleteSong.run(file);
        result.removed.push({ file, to, reason: group.reasons[file] });
      } catch (err) {
        result.failed.push({ file, error: err.message });
      }
    }
    onProgress(i + 1, groups.length);
  }
  return result;
};

module.exports = {
  applyDuplicates,
  duplicateGroups,
  isNumbered,
  mergedTags,
  planDuplicates,
  planGroup,
  releaseType,
  resolveGroup,
  trashPath
};
