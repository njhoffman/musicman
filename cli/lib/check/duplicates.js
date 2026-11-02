const _ = require('lodash');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const NodeId3 = require('node-id3');

const { execBeet } = require('../beets/sort.js');
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

// a copy in a Singles folder (or the unsorted _Singles), the only copies whose files are deleted
const inSinglesFolder = songPath => /(^|\/)_?Singles\//.test(`${songPath}`);

// an album copy filed under an artist (Rated/<genre>/<grouping>/Artists/<artist>/album/...)
const artistAlbum = songPath =>
  releaseType(songPath) === 'album' && /(^|\/)Artists\//.test(`${songPath}`);

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
 * What to do with one group of duplicates ({ path, mtime, rating, audio }), by rules in order:
 *   another recording (a live or remix release, or a version like a radio edit in the title) next to
 *   the song is a wrong match, not a duplicate: its match is cleared so sync --match finds its own
 *   track (clear), the file and the song stay
 *   a Rated copy wins over Unrated imports
 *   of numbered copies (Song.1.mp3 and Song.mp3) the one without the number wins when their audio is
 *   the same; numbered copies with other audio are left to pick
 *   an album copy wins over an EP, an EP over a single, a single over a compilation (releaseRank)
 * A losing copy's file goes to the trash only when it is a single in a Singles folder and an album copy
 * under Artists is kept, or a numbered copy with the same audio (trash); any other losing copy leaves
 * the library and Spotify but its file stays (exclude). Returns { keep, trash, exclude, clear,
 * candidates, reasons }: keep is null when copies tie, and candidates lists the copies to pick from
 * (the others are excluded, resolveGroup). Tied copies with the same audio are decided too: the one
 * whose file name is closest to its title (TIT2), then to its Spotify artist and title, is kept, and
 * the others go to the trash from a Singles
 * folder or are excluded elsewhere. audio(item) gives a copy's audioHash (null when unknown).
 */
const planGroup = (files, { audio = item => item.audio || null } = {}) => {
  const reasons = {};
  const trash = [];
  const exclude = [];
  const losers = [];
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
    losers.push(..._.map(imports, item => ({ item, reason: 'Unrated import of a Rated song' })));
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
      _.each(same, item => {
        trash.push(item.path);
        reasons[item.path] = 'numbered copy with the same audio';
      });
      members = _.difference(members, same);
    }
  );
  const rank = item => releaseRank[releaseType(item.path)];
  const best = _.min(_.map(members, rank));
  const [top, lower] = _.partition(members, item => rank(item) === best);
  losers.push(
    ..._.map(lower, item => ({
      item,
      reason: `${releaseType(item.path)} copy, the ${releaseType(top[0].path)} copy is kept`
    }))
  );
  const albumKept = top.length > 0 && _.every(top, item => artistAlbum(item.path));
  _.each(losers, ({ item, reason }) => {
    (inSinglesFolder(item.path) && albumKept ? trash : exclude).push(item.path);
    reasons[item.path] = reason;
  });
  let keep = top.length === 1 ? top[0].path : null;
  if (!keep && top.length > 1) {
    const sounds = _.map(top, audio);
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
    // identical audio, and one name closest to its title: no pick needed
    if (sounds[0] && _.uniq(sounds).length === 1 && closer) {
      keep = named[0].item.path;
      _.each(_.tail(named), ({ item }) => {
        (inSinglesFolder(item.path) ? trash : exclude).push(item.path);
        reasons[item.path] = 'same audio, the copy named closest to its title is kept';
      });
    }
  }
  return { keep, trash, exclude, clear, candidates: keep ? [] : _.map(top, 'path'), reasons };
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
 * plan needs and shows: { files: [{ id, path, mtime, size, duration, rating, trackId, title,
 * spotifyTitle }] }.
 */
const duplicateGroups = (db, findings) => {
  const select = db.prepare(
    'SELECT id, path, mtime, size, duration, rating FROM songs WHERE path = ?'
  );
  const trackOf = db.prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ?');
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
    ({ trash, exclude, clear, candidates }) =>
      trash.length + exclude.length + clear.length + candidates.length > 0
  );
};

// the copies a group takes out of the library: trashed and excluded
const removedCopies = group => [...group.trash, ...group.exclude];

// a group after the copy to keep was picked among its candidates: the others leave the library, their
// files stay (excluded)
const resolveGroup = (group, keep) => {
  if (!keep) {
    return group;
  }
  const others = _.without(group.candidates, keep);
  return {
    ...group,
    keep,
    candidates: [],
    exclude: [...group.exclude, ...others],
    reasons: {
      ...group.reasons,
      ..._.fromPairs(_.map(others, file => [file, 'not the copy picked']))
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
 * Applies resolved groups (keep picked, no candidates left): merges the multi value fields and newer
 * rating of the copies taken out into the kept copy, clears the Spotify match of other recordings
 * (their id is rejected for them, so sync --match finds their own track), moves trashed copies to the
 * trash (trashPath) after taking them out of beets, and excludes the others (out of the database and
 * Spotify, files kept). Trashed and excluded songs are listed in excluded_songs with their Spotify
 * track, which sync removes from the playlists. Everything is recorded for musicman undo. Resolves to
 * { merged, cleared, removed, excluded, failed } (failed: [{ file, error }]).
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
  const result = { merged: [], cleared: [], removed: [], excluded: [], failed: [] };
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const byPath = _.keyBy(group.files, 'path');
    if (group.keep && removedCopies(group).length > 0) {
      try {
        const others = _.map(removedCopies(group), file => ({
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
    for (const file of group.exclude) {
      try {
        excludeSong(db, {
          path: file,
          trackId: byPath[file].trackId,
          kept: group.keep,
          reason: group.reasons[file]
        });
        recordFileMove({ action: 'exclude', file: absolute(file), to: absolute(group.keep) });
        result.excluded.push({ file, reason: group.reasons[file] });
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
          trackId: byPath[file].trackId,
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
  return result;
};

module.exports = {
  applyDuplicates,
  audioHash,
  duplicateGroups,
  isNumbered,
  mergedTags,
  planDuplicates,
  planGroup,
  releaseType,
  removedCopies,
  titleCloseness,
  resolveGroup,
  trashPath
};
