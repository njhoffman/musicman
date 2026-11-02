const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const NodeId3 = require('node-id3');
const yaml = require('js-yaml');
const globalTags = require('musicman-common/config/tags.json');

const { assignFields, fetchDetails } = require('../spotify/fields.js');
const { execBeet, groupingHintFrame } = require('../beets/sort.js');
const { downloadTrackId, downloadedFiles } = require('./download.js');
const { relinkHistory } = require('../history/relink.js');
const { likePrefix } = require('../db/update.js');
const { prepareRating, rewriteTags, updateTags } = require('../metadata/write.js');

// frame of a tag name, user tags first like library.tags
const tagFrame = (config, name) =>
  _.get(_.find(config.tags || [], { name }) || _.find(globalTags, { name }), 'id');

// current value of a frame in raw node-id3 tags, custom fields by TXXX.<description>
const rawValue = (raw, frame) => {
  if (frame.startsWith('TXXX.')) {
    const description = frame.slice(5);
    return _.get(_.find([].concat(raw.TXXX || []), { description }), 'value');
  }
  return raw[frame];
};

// POPM frames without an email: spotDL's Spotify popularity (rating = popularity * 255 / 100)
const popularityFrames = raw => _.reject([].concat(raw.POPM || []), 'email');

/**
 * Tags written to a download: the Spotify fields (when the track details could be fetched), standard
 * tags the file has no value for, and the tags of the playlists the manifest track is in. A grouping is
 * kept as a hint (groupingHintFrame) rather than in TIT1, so beets files the download under its unsorted
 * folder until it is rated; musicman sort then applies it. Downloads are
 * imported as singletons, so they get no album fields (scope: album); sync --match adds them once the
 * song is sorted into an album folder. Returns
 * { custom, filled, playlist, rating, popularity } with frame ids (popularity: spotDL's popularity POPM
 * is to be removed), and the response paths no field covers.
 */
const importTags = ({ raw, entry, objects, config, now }) => {
  const assignment = objects
    ? assignFields(objects, config, now, { album: false })
    : { custom: [{ name: 'sp_track_id', value: entry.trackId }], fallbacks: [], unassigned: [] };
  const filled = _.compact(
    _.map(assignment.fallbacks, ({ name, value }) => {
      const frame = tagFrame(config, name);
      return frame && !rawValue(raw, frame) ? { name, frame, value } : null;
    })
  );
  // playlist tags (grouping:IndieRock.Artists, context:Study) are what places the song in its playlists
  const playlist = _.compact(
    _.map(entry.tags, (value, name) => {
      const frame = name === 'grouping' ? groupingHintFrame : tagFrame(config, name);
      return frame ? { name, frame, value: [].concat(value).join(',') } : null;
    })
  );
  // the rating of a rating playlist (rating:4.5-4.5) is written like edit writes it
  const rating = _.get(entry, 'tags.rating')
    ? {
        frame: config.rating.tag,
        value: entry.tags.rating,
        tag: prepareRating(entry.tags.rating, config.rating)
      }
    : null;
  return {
    custom: assignment.custom,
    filled,
    playlist,
    rating,
    // spotDL writes the Spotify popularity to POPM, the rating frame, without an email; a playlist
    // rating replaces it, otherwise it is removed so the download does not read as rated
    popularity: !rating && popularityFrames(raw).length > 0,
    unassigned: assignment.unassigned
  };
};

const writeImportTags = (file, { custom, filled, playlist, rating, popularity }) => {
  if (popularity) {
    rewriteTags(file, raw => {
      const kept = _.filter([].concat(raw.POPM || []), 'email');
      return kept.length > 0 ? { ...raw, POPM: kept } : _.omit(raw, 'POPM');
    });
  }
  const frames = [...filled, ...playlist];
  updateTags(
    {
      userDefinedText: [
        ..._.map(custom, ({ name, value }) => ({ description: name, value })),
        ..._.map(
          _.filter(frames, ({ frame }) => frame.startsWith('TXXX.')),
          ({ frame, value }) => ({
            description: frame.slice(5),
            value
          })
        )
      ],
      ..._.fromPairs(
        _.map(
          _.reject(frames, ({ frame }) => frame.startsWith('TXXX.')),
          ({ frame, value }) => [frame, value]
        )
      ),
      ...(rating ? { [rating.frame]: rating.tag } : {})
    },
    file
  );
};

// files beets imported as-is (no MusicBrainz match) or skipped, from its import log lines
const parseBeetsLog = text =>
  _.groupBy(
    _.compact(
      _.map(`${text || ''}`.split('\n'), line => {
        const match = line.match(/^(asis|skip|duplicate-replace|duplicate-skip)\s+(.+)$/);
        return match ? { action: match[1], file: match[2].split('; ')[0] } : null;
      })
    ),
    'action'
  );

/**
 * The -c argument of the beets import: sync.beetsConfig, or with sync.importLyrics false a copy of it
 * with lyrics.auto off, written next to the downloads (beets layers -c over its user config, so the
 * copy keeps every other setting). Returns [] without a beets config.
 */
const importConfigArgs = (config, { write = fs.writeFileSync } = {}) => {
  const configPath = _.get(config, 'sync.beetsConfig');
  if (_.get(config, 'sync.importLyrics', true) !== false) {
    return configPath ? ['-c', configPath] : [];
  }
  const base =
    configPath && fs.existsSync(configPath)
      ? yaml.load(fs.readFileSync(configPath, 'utf8')) || {}
      : {};
  const overlay = path.join(config.sync.downloadDirectory, 'beets-import.yaml');
  write(overlay, yaml.dump(_.merge({}, base, { lyrics: { auto: false } })));
  return ['-c', overlay];
};

/**
 * History paths in the download folder whose files are gone: downloads tagged by sync --import that
 * beets moved, but whose history was not pointed at the library (an interrupted import, or one from
 * before the history followed moves).
 */
const staleDownloads = (db, config, { exists = fs.existsSync } = {}) =>
  _.reject(
    _.map(
      db
        .prepare(`SELECT DISTINCT path FROM tag_changes WHERE path LIKE ? ESCAPE '\\'`)
        .all(likePrefix(path.resolve(config.sync.downloadDirectory))),
      'path'
    ),
    file => exists(file)
  );

/**
 * Finishes the downloads an interrupted sync --import left behind (stale, from staleDownloads): each is
 * matched by the track id in its name to the one library song with that sp_track_id (the database must
 * be up to date), its manifest track is marked importedAt, and its history points at the song. A track
 * downloaded again, or with no or several songs, is left alone. Returns the recovered
 * { trackId, from, to }.
 */
const recoverImports = ({ db, config, manifest, stale, now = new Date() }) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const present = new Set(_.compact(_.map(downloadedFiles(config), file => downloadTrackId(file))));
  const select = db.prepare(
    `SELECT songs.path FROM songs JOIN song_tags ON song_tags.song_id = songs.id
     WHERE song_tags.frame_id = 'TXXX.sp_track_id' AND song_tags.value = ?`
  );
  const entries = _.keyBy(_.get(manifest, 'tracks', []), 'trackId');
  const recovered = _.compact(
    _.map(stale, from => {
      const trackId = downloadTrackId(from);
      const songs = trackId && !present.has(trackId) ? select.all(trackId) : [];
      if (songs.length !== 1) {
        return null;
      }
      const entry = entries[trackId];
      if (entry && !entry.importedAt) {
        entry.importedAt = now.toISOString();
      }
      return { trackId, from, to: path.join(baseDirectory, songs[0].path) };
    })
  );
  relinkHistory(db, recovered, { baseDirectory });
  return recovered;
};

/**
 * Tags downloaded files with their manifest track (Spotify fields, empty standard tags, playlist tags)
 * and imports them into the library with beets as singletons, as is (no autotagging). Files without a
 * track id, or whose track
 * is not in the manifest, are left alone. Without track details (e.g. rate limited), files still get
 * their id and playlist tags; sync --match fills their Spotify fields later. With dryRun nothing is
 * written and beets is not run. Imported tracks are marked importedAt in the manifest. onProgress(phase,
 * done, total) reports the phases: details (the Spotify lookup starts), tagging (per file), and beets
 * (downloads gone from the folder, checked every pollMs while beets runs).
 */
const importDownloads = async ({
  config,
  client,
  manifest,
  files,
  beetsLog,
  dryRun = false,
  now = new Date(),
  runBeet = execBeet,
  readTags = file => NodeId3.read(file).raw || {},
  onFile = _.noop,
  onProgress = _.noop,
  exists = fs.existsSync,
  pollMs = 1000
}) => {
  const entries = _.keyBy(_.get(manifest, 'tracks', []), 'trackId');
  const found = _.map(files, file => {
    const raw = readTags(file);
    const trackId = downloadTrackId(file, raw);
    return { file, raw, trackId, entry: trackId ? entries[trackId] : null };
  });
  const unknown = _.reject(found, 'entry');
  _.each(unknown, ({ file, trackId }) =>
    onFile('unknown', { file, trackId }, trackId ? 'not in the manifest' : 'no Spotify track id')
  );
  const toImport = _.filter(found, ({ entry }) => entry && !entry.importedAt);

  let details = new Map();
  let detailsError = null;
  onProgress('details', 0, toImport.length);
  try {
    const trackIds = _.map(toImport, 'trackId');
    details = await fetchDetails(client, trackIds, config, new Map(), {
      singles: new Set(trackIds)
    });
  } catch (err) {
    detailsError = err.message;
  }

  const unassigned = {};
  const tagged = _.map(toImport, (item, i) => {
    const tags = importTags({ ...item, objects: details.get(item.trackId), config, now });
    _.each(tags.unassigned, fieldPath => {
      unassigned[fieldPath] = (unassigned[fieldPath] || 0) + 1;
    });
    if (!dryRun) {
      writeImportTags(item.file, tags);
    }
    onFile('tagged', item, tags);
    onProgress('tagging', i + 1, toImport.length);
    return { ...item, tags };
  });

  let beets = {};
  if (!dryRun && tagged.length > 0) {
    const configArgs = importConfigArgs(config);
    // beets moves each download out of the folder once imported (import.move), so the files gone count
    // its progress; with copy the count stays 0
    const taggedFiles = _.map(tagged, 'file');
    const countGone = () =>
      onProgress('beets', _.reject(taggedFiles, file => exists(file)).length, tagged.length);
    countGone();
    const timer = setInterval(countGone, pollMs);
    await runBeet([
      ...configArgs,
      'import',
      '-s',
      '-q',
      // as is, without autotagging: the tags already describe the manifest's exact Spotify track, and
      // beets' matches picked other releases of a song and wrote Spotify ids into the MusicBrainz fields
      '-A',
      '-l',
      beetsLog,
      ...taggedFiles
    ]).finally(() => clearInterval(timer));
    countGone();
    beets = parseBeetsLog(fs.existsSync(beetsLog) ? fs.readFileSync(beetsLog, 'utf8') : '');
    const skipped = new Set(_.map(beets.skip, 'file'));
    _.each(tagged, ({ entry, file }) => {
      if (!skipped.has(file) && !fs.existsSync(file)) {
        entry.importedAt = now.toISOString();
      }
    });
  }

  return {
    tagged: tagged.length,
    imported: _.filter(tagged, ({ entry }) => entry.importedAt).length,
    unknown: _.map(unknown, 'file'),
    skipped: _.map(beets.skip, 'file'),
    unassigned,
    detailsError,
    dryRun,
    files: _.map(tagged, ({ file, trackId, tags }) => ({
      file,
      trackId,
      fields: tags.custom.length,
      filled: _.map(tags.filled, 'name'),
      popularity: tags.popularity,
      playlist: [
        // the grouping hint under its own name: it is not the song's grouping until sort applies it
        ..._.map(tags.playlist, ({ name, frame, value }) =>
          frame === groupingHintFrame ? `${frame.slice(5)}:${value}` : `${name}:${value}`
        ),
        ...(tags.rating ? [`rating:${tags.rating.value}`] : [])
      ]
    }))
  };
};

/**
 * Where beets moved the imported downloads, for the undo history (relinkHistory): each download that is
 * gone from its folder, paired with the one song added by the database update after the import (added:
 * library relative paths) that carries its Spotify track id. A download whose id matches no added song,
 * or several, is left out. Returns { from, to } pairs of absolute paths.
 */
const importedMoves = ({ db, baseDirectory, files, added, exists = fs.existsSync }) => {
  const addedPaths = new Set(added);
  const select = db.prepare(
    `SELECT songs.path FROM songs JOIN song_tags ON song_tags.song_id = songs.id
     WHERE song_tags.frame_id = 'TXXX.sp_track_id' AND song_tags.value = ?`
  );
  return _.compact(
    _.map(files, ({ file, trackId }) => {
      if (!trackId || exists(file)) {
        return null;
      }
      const songs = _.filter(_.map(select.all(trackId), 'path'), song => addedPaths.has(song));
      return songs.length === 1 ? { from: file, to: path.join(baseDirectory, songs[0]) } : null;
    })
  );
};

module.exports = {
  importConfigArgs,
  importDownloads,
  importedMoves,
  importTags,
  parseBeetsLog,
  recoverImports,
  staleDownloads
};
