const _ = require('lodash');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const NodeId3 = require('node-id3');

const { execBeet } = require('../beets/sort.js');
const { updateDatabase } = require('../db/update.js');
const { excludeSong } = require('../db/exclusions.js');
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

// a copy in a Singles folder (or the unsorted _Singles), the only copies a duplicate rule removes
const inSinglesFolder = songPath => /(^|\/)_?Singles\//.test(`${songPath}`);

// version words in a file name that mark another recording of a song: Song (Arsenal mix).mp3
const versionWords =
  /\b(re-?mix|mix|edit|live|acoustic|demo|instrumental|unplugged|session|vocal)\b/i;
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
 * What to do with one group of duplicates ({ path, mtime, rating, audio }). One copy of a song is kept
 * and holds its rating. Copies outside Singles folders (under Artists, an Unrated album import) stay in
 * the library for a complete discography: when one loses and is rated, its rating moves to the kept
 * copy and is removed from it (unrate), so it is in no rating playlist and not on Spotify. Rules:
 *   another recording (a live or remix release, or a version like a radio edit in the title) next to
 *   the song is a wrong match, not a duplicate: its match is cleared so sync --match finds its own
 *   track (clear), the file and the song stay; one linked to no track is left out of the group
 *   a Rated copy wins over Unrated imports: a singleton import (Unrated/_Singles) goes to the trash,
 *   an Unrated album track is unrated
 *   of numbered copies (Song.1.mp3 and Song.mp3) the one without the number wins when their audio is
 *   the same, in any folder, and the numbered one goes to the trash; numbered copies with other audio
 *   are left to pick
 *   with a Rated copy outside the Singles folders (under Artists), every Singles copy goes to the
 *   trash, and of those copies an album wins over an EP, an EP over a single release, a single release
 *   over a compilation (releaseRank); the others are unrated
 *   else the Singles copies are decided among themselves (an Unrated album import beside them, with no
 *   Rated copy, is left alone)
 *   tied copies: outside the Singles folders the only rated one wins (nothing to do without two rated
 *   copies); else with the same audio, the one whose file name is closest to its title (TIT2), then to
 *   its Spotify artist and title, wins; other ties are left to pick (resolveGroup)
 * Returns { keep, trash, exclude, unrate, clear, candidates, reasons }: keep is null when copies tie,
 * and candidates lists the copies to pick from. audio(item) gives a copy's audioHash (null when
 * unknown).
 */
// the Spotify track a copy is linked to: its Spotify id tag, else its match (a review candidate too)
const linkedTrack = item => item.trackId || item.matchedTrack || null;

// a copy with a rating in the database
const isRated = item => Number(item.rating) > 0;

/**
 * What happens to a copy that loses: a Singles copy (or one forced to, toTrash) goes to the trash, a
 * rated copy elsewhere is unrated, an unrated one is left as it is.
 */
const loseCopy = ({ trash, unrate, reasons }, item, reason, toTrash = false) => {
  if (toTrash || inSinglesFolder(item.path)) {
    trash.push(item.path);
  } else if (isRated(item)) {
    unrate.push(item.path);
  } else {
    return;
  }
  reasons[item.path] = reason;
};

const planGroup = (files, { audio = item => item.audio || null } = {}) => {
  const reasons = {};
  const trash = [];
  const exclude = [];
  const unrate = [];
  const lose = (item, reason, toTrash) =>
    loseCopy({ trash, unrate, reasons }, item, reason, toTrash);
  const [others, originals] = _.partition(files, item => otherRecording(item.path));
  // another recording linked to no track (its match rejected before) is no duplicate, nothing to clear
  const clear =
    others.length > 0 && originals.length > 0 ? _.map(_.filter(others, linkedTrack), 'path') : [];
  _.each(clear, file => {
    reasons[file] = otherRecording(file);
  });
  let members = others.length > 0 && originals.length > 0 ? originals : files;
  const plan = (keep, candidates = []) => ({
    keep,
    trash,
    exclude,
    unrate,
    clear,
    candidates,
    reasons
  });
  const [imports, rated] = _.partition(members, item => unsorted(item.path));
  if (imports.length > 0 && rated.length > 0) {
    _.each(imports, item => lose(item, 'Unrated import of a Rated song'));
    members = rated;
  }
  _.each(
    _.filter(
      _.groupBy(members, item => numberedKey(item.path)),
      group => group.length > 1
    ),
    group => {
      const original = _.find(group, item => !isNumbered(item.path));
      if (!original) {
        return;
      }
      // the file without the number keeps its name; the newer copy's rating reaches it (mergedTags)
      const same = _.filter(
        _.without(group, original),
        item => audio(item) && audio(item) === audio(original)
      );
      _.each(same, item => lose(item, 'numbered copy with the same audio', true));
      members = _.difference(members, same);
    }
  );
  const [singles, deliberate] = _.partition(members, item => inSinglesFolder(item.path));
  let top = singles;
  if (_.some(deliberate, item => !unsorted(item.path))) {
    const rank = item => releaseRank[releaseType(item.path)];
    const best = _.min(_.map(deliberate, rank));
    const [kept, lower] = _.partition(deliberate, item => rank(item) === best);
    const type = releaseType(kept[0].path);
    _.each(singles, item => lose(item, `Singles copy, the ${type} copy under Artists is kept`));
    _.each(lower, item => lose(item, `${releaseType(item.path)} copy, the ${type} copy is kept`));
    // copies kept outside the Singles folders hold no rating but one: only rated ties are decided
    const rated = _.filter(kept, isRated);
    if (rated.length < 2) {
      return plan((rated[0] || kept[0]).path);
    }
    top = rated;
  }
  if (top.length < 2) {
    return plan(_.get(top, [0, 'path'], null));
  }
  // closest to its own title, then (when those tie) to the Spotify artist and title
  const named = _.orderBy(
    _.map(top, item => ({
      item,
      score: titleCloseness(item.path, item.title),
      spotify: item.spotifyTitle ? titleCloseness(item.path, item.spotifyTitle) : 0
    })),
    ['score', 'spotify'],
    ['desc', 'desc']
  );
  const closer =
    named[0].score > named[1].score ||
    (named[0].score === named[1].score && named[0].spotify > named[1].spotify);
  const sounds = _.map(top, audio);
  // identical audio, and one name closest to its title: no pick needed
  if (sounds[0] && _.uniq(sounds).length === 1 && closer) {
    _.each(_.tail(named), ({ item }) =>
      lose(item, 'same audio, the copy named closest to its title is kept')
    );
    return plan(named[0].item.path);
  }
  return plan(null, _.map(top, 'path'));
};

// letter pairs of a text, for titleCloseness
const pairs = text => _.map(_.range(Math.max(text.length - 1, 0)), i => text.slice(i, i + 2));

/**
 * How close a file name is to a title, 0 to 1: 1 when the name (without its track number, a numbered
 * copy's number, or the "Artist - " of a Singles file) is the title in any case, else the share of
 * letter pairs they have in common (Dice). 0 without a title.
 */
const titleCloseness = (songPath, title) => {
  if (!title) {
    return 0;
  }
  const want = `${title}`.trim().toLowerCase();
  const name = path
    .basename(`${songPath}`)
    .replace(/(\.\d+)?\.mp3$/i, '')
    .replace(/^\d+ - /, '')
    .toLowerCase();
  const names = _.uniq([name, name.includes(' - ') ? name.slice(name.indexOf(' - ') + 3) : name]);
  return _.max(
    _.map(names, candidate => {
      if (candidate === want) {
        return 1;
      }
      const a = pairs(candidate);
      const b = pairs(want);
      if (a.length + b.length === 0) {
        return 0;
      }
      const left = [...b];
      const common = _.filter(a, pair => {
        const index = left.indexOf(pair);
        if (index < 0) {
          return false;
        }
        left.splice(index, 1);
        return true;
      }).length;
      return (2 * common) / (a.length + b.length);
    })
  );
};

/**
 * A hash of a file's audio, without its ID3v2 tag at the start and ID3v1 tag at the end, so copies with
 * other tags compare equal; null when it cannot be read.
 */
const audioHash = file => {
  try {
    const data = fs.readFileSync(file);
    let start = 0;
    if (data.length > 10 && data.toString('latin1', 0, 3) === 'ID3') {
      // the tag size is syncsafe (7 bits per byte), plus the header and a footer when flagged
      const size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9];
      start = 10 + size + (data[5] & 0x10 ? 10 : 0);
    }
    const end =
      data.length >= 128 && data.toString('latin1', data.length - 128, data.length - 125) === 'TAG'
        ? data.length - 128
        : data.length;
    return crypto.createHash('sha1').update(data.subarray(start, end)).digest('hex');
  } catch {
    return null;
  }
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
 * plan needs and shows: { files: [{ id, path, mtime, size, duration, rating, rated_at, trackId, matchedTrack,
 * title, spotifyTitle }] } (trackId from the Spotify id tag, matchedTrack from a match or review row).
 */
const duplicateGroups = (db, findings) => {
  const select = db.prepare(
    'SELECT id, path, mtime, size, duration, rating, rated_at FROM songs WHERE path = ?'
  );
  const trackOf = db.prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ?');
  const matchOf = db.prepare(
    `SELECT track_id FROM spotify_matches
     WHERE song_id = ? AND status IN ('match', 'review') AND track_id IS NOT NULL`
  );
  // "artist - title" on Spotify, to tell apart copies whose names match their own titles alike
  const spotifyTitleOf = id => {
    const title = _.get(trackOf.get(id, 'TXXX.sp_title'), 'value');
    const artist = _.get(trackOf.get(id, 'TXXX.sp_artist'), 'value');
    return title ? _.compact([artist, title]).join(' - ') : null;
  };
  return _.compact(
    _.map(joinOverlapping(_.map(findings, 'files')), files => {
      const rows = _.compact(_.map(files, file => select.get(file)));
      if (rows.length < 2) {
        return null;
      }
      return {
        files: _.map(rows, row => ({
          ...row,
          trackId: _.get(trackOf.get(row.id, spotifyIdFrame), 'value') || null,
          matchedTrack: _.get(matchOf.get(row.id), 'track_id') || null,
          title: _.get(trackOf.get(row.id, 'TIT2'), 'value') || null,
          spotifyTitle: spotifyTitleOf(row.id)
        }))
      };
    })
  );
};

/**
 * Plans every group: [{ files, keep, trash, exclude, clear, candidates, reasons }], groups with nothing
 * to do left out. Audio hashes are read from baseDirectory only where a rule needs them (numbered
 * copies, tied copies) and kept on the files (audio, null when not read).
 */
const planDuplicates = (groups, { baseDirectory, hash = audioHash } = {}) => {
  const read = _.memoize(songPath =>
    baseDirectory ? hash(path.join(baseDirectory, songPath)) : null
  );
  const audio = item => (item.audio !== undefined ? item.audio : read(item.path));
  return _.filter(
    _.map(groups, group => {
      const plan = planGroup(group.files, { audio });
      const files = _.map(group.files, item => ({
        ...item,
        audio:
          item.audio !== undefined ? item.audio : read.cache.has(item.path) ? read(item.path) : null
      }));
      return { ...group, files, ...plan };
    }),
    ({ trash, exclude, unrate, clear, candidates }) =>
      trash.length + exclude.length + unrate.length + clear.length + candidates.length > 0
  );
};

// the copies a group takes out of the library: trashed and excluded
const removedCopies = group => [...group.trash, ...group.exclude];

// the copies whose tags reach the kept copy: the ones taken out, and the ones unrated
const mergedCopies = group => [...removedCopies(group), ...(group.unrate || [])];

// a group after the copy to keep was picked among its candidates: the others leave the library, their
// files stay (excluded)
const resolveGroup = (group, keep) => {
  if (!keep) {
    return group;
  }
  const others = _.without(group.candidates, keep);
  const byPath = _.keyBy(group.files, 'path');
  // a Singles copy not picked leaves the library (file kept); one elsewhere stays, unrated
  const [singles, deliberate] = _.partition(others, inSinglesFolder);
  const unrate = _.filter(deliberate, file => isRated(byPath[file] || {}));
  return {
    ...group,
    keep,
    candidates: [],
    exclude: [...group.exclude, ...singles],
    unrate: [...(group.unrate || []), ...unrate],
    reasons: {
      ...group.reasons,
      ..._.fromPairs(_.map([...singles, ...unrate], file => [file, 'not the copy picked']))
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
 * once, in any case), and the rating (POPM) of the copy rated last when it differs: by ratedAt (when
 * db --update saw its rating change), a copy with one before a copy without; the file time (mtime) only
 * between copies with none, since any tag write makes a file newer. Pure.
 */
const mergedTags = ({ keepRaw, keepMtime, keepRatedAt = null, others, descriptions }) => {
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
    [{ raw: keepRaw, mtime: keepMtime, ratedAt: keepRatedAt }, ...others],
    ({ raw: tags }) => !_.isEmpty(tags.POPM)
  );
  // rated_at is datetime('now') text, which sorts as it reads
  const newest = _.last(
    _.sortBy(rated, [({ ratedAt }) => (ratedAt ? 1 : 0), ({ ratedAt }) => ratedAt || '', 'mtime'])
  );
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
 * Applies resolved groups (keep picked, no candidates left): merges the multi value fields and newer
 * rating of the copies taken out into the kept copy, clears the Spotify match of other recordings
 * (their id is rejected for them, so sync --match finds their own track), moves trashed copies to the
 * trash (trashPath) after taking them out of beets, and excludes the others (out of the database and
 * Spotify, files kept), and removes the rating of the copies unrated (they stay in the library). Trashed
 * and excluded songs are listed in excluded_songs with their Spotify track, which sync removes from the
 * playlists. The kept and unrated copies are read into the database again (update). Everything is
 * recorded for musicman undo. Resolves to { merged, cleared, removed, excluded, unrated, failed }
 * (unrated: [{ file, reason }]; failed: [{ file, error }]).
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
  update = updateDatabase,
  onProgress = _.noop
}) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const absolute = songPath => path.join(baseDirectory, songPath);
  const descriptions = multiDescriptions(config);
  const result = { merged: [], cleared: [], removed: [], excluded: [], unrated: [], failed: [] };
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const byPath = _.keyBy(group.files, 'path');
    if (group.keep && mergedCopies(group).length > 0) {
      try {
        const others = _.map(mergedCopies(group), file => ({
          raw: read(absolute(file)),
          mtime: byPath[file].mtime,
          ratedAt: byPath[file].rated_at || null
        }));
        const keepRaw = read(absolute(group.keep));
        const { raw, changes } = mergedTags({
          keepRaw,
          keepMtime: byPath[group.keep].mtime,
          keepRatedAt: byPath[group.keep].rated_at || null,
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
        _.map(group.clear, file => {
          const trackId = linkedTrack(byPath[file]);
          return trackId
            ? {
                songId: byPath[file].id,
                file: absolute(file),
                linked: Boolean(byPath[file].trackId),
                candidate: { id: trackId }
              }
            : null;
        })
      );
      // a song linked by its tags alone has no match row to hold the rejection
      const ensureRow = db.prepare(
        `INSERT INTO spotify_matches (song_id, status, track_id, source, checked_at)
         VALUES (?, 'match', ?, 'tags', datetime('now')) ON CONFLICT (song_id) DO NOTHING`
      );
      _.each(_.filter(items, 'linked'), item =>
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
    for (const file of group.exclude) {
      try {
        excludeSong(db, {
          path: file,
          trackId: linkedTrack(byPath[file]),
          kept: group.keep,
          reason: group.reasons[file]
        });
        recordFileMove({ action: 'exclude', file: absolute(file), to: absolute(group.keep) });
        result.excluded.push({ file, reason: group.reasons[file] });
      } catch (err) {
        result.failed.push({ file, error: err.message });
      }
    }
    // one copy of a song holds its rating (mergedTags gave it the newest): the others keep their
    // place in the library, unrated, so no rating playlist and no Spotify sync takes them
    for (const file of group.unrate || []) {
      try {
        if (!_.isEmpty(read(absolute(file)).POPM)) {
          const written = write(absolute(file), raw => _.omit(raw, 'POPM'));
          if (written instanceof Error) {
            throw written;
          }
        }
        result.unrated.push({ file, reason: group.reasons[file] });
      } catch (err) {
        result.failed.push({ file, error: err.message });
      }
    }
    for (const file of group.trash) {
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
        // listed for its Spotify track, which sync removes in favor of the copy kept
        excludeSong(db, {
          path: file,
          trackId: linkedTrack(byPath[file]),
          kept: group.keep,
          reason: group.reasons[file]
        });
        result.removed.push({ file, to, reason: group.reasons[file] });
      } catch (err) {
        result.failed.push({ file, error: err.message });
      }
    }
    onProgress(i + 1, groups.length);
  }
  // the database reads the kept copies' merged tags and the unrated copies again
  const changed = _.uniq([..._.map(result.merged, 'file'), ..._.map(result.unrated, 'file')]);
  if (changed.length > 0) {
    await update(db, { config, files: _.map(changed, absolute), record: false });
  }
  return result;
};

module.exports = {
  applyDuplicates,
  audioHash,
  duplicateGroups,
  inSinglesFolder,
  isNumbered,
  mergedTags,
  otherRecording,
  planDuplicates,
  planGroup,
  releaseType,
  removedCopies,
  titleCloseness,
  resolveGroup,
  trashPath
};
