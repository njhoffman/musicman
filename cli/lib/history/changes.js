const _ = require('lodash');
const os = require('os');
const path = require('path');

const { parseMetadata } = require('../metadata/read.js');
const { trackIdName } = require('../spotify/fields.js');

/**
 * The change log: every change of a library field (a tag write) and of a Spotify match decision, by
 * field rather than by frame, with the song named by its audio hash (and its MusicBrainz and Spotify ids
 * as hints), so another computer can apply it to its own copy (docs/10-host-sync.md). Written by the
 * undo journal's choke points (journaledWrite, journaledMatch), never pruned with the undo history.
 *
 * Kinds: set (a single value field: value and previous, null for none), add and remove (one value of a
 * multi value field), match (the song's spotify_matches decision after the change, JSON, null when
 * cleared). origin is the id of another computer's entry this one applied (pulled, not pushed again).
 */

// this computer's name in the log: hostSync.name, else the hostname
const hostName = (config, hostname = os.hostname()) => _.get(config, 'hostSync.name') || hostname;

// the library fields a file's raw node-id3 tags hold, by name (rating included), values as strings
const fieldValues = (raw, config) =>
  _.mapValues(
    _.omitBy(_.omit(parseMetadata(raw || {}, config), ['duration', 'size']), _.isNil),
    value => (_.isArray(value) ? value.join(`${_.get(config, 'delimiter', ',')} `) : `${value}`)
  );

const splitValues = (text, delimiter) =>
  _.uniq(
    _.compact(_.map(`${_.isNil(text) ? '' : text}`.split(delimiter), item => `${item}`.trim()))
  );

/**
 * The changes between a file's fields before and after a write: [{ kind, field, value, previous }].
 * Multi value fields (library.tags multi) give one add or remove per value; others one set.
 */
const fieldChanges = (beforeRaw, afterRaw, config) => {
  const before = fieldValues(beforeRaw, config);
  const after = fieldValues(afterRaw, config);
  const delimiter = _.get(config, 'delimiter', ',');
  const multi = new Set(_.map(_.filter(_.get(config, 'library.tags', []), 'multi'), 'name'));
  return _.flatMap(_.sortBy(_.union(_.keys(before), _.keys(after))), field => {
    if (multi.has(field)) {
      const was = splitValues(before[field], delimiter);
      const now = splitValues(after[field], delimiter);
      return [
        ..._.map(_.difference(now, was), value => ({ kind: 'add', field, value, previous: null })),
        ..._.map(_.difference(was, now), value => ({
          kind: 'remove',
          field,
          value,
          previous: null
        }))
      ];
    }
    const value = _.has(after, field) ? after[field] : null;
    const previous = _.has(before, field) ? before[field] : null;
    return value === previous ? [] : [{ kind: 'set', field, value, previous }];
  });
};

/**
 * What names a song in the log, from its database row (by path relative to the music directory, or by
 * id): { hash, mbid, spotify, path }; the path alone for a file the database does not hold yet.
 */
const songIdentity = (db, { relativePath = null, songId = null }) => {
  const row = db
    .prepare(
      `SELECT s.path, s.audio_hash, s.mb_track_id,
         (SELECT value FROM song_tags t WHERE t.song_id = s.id AND t.frame_id = ?) AS spotify
       FROM songs s WHERE ${songId ? 's.id = ?' : 's.path = ?'}`
    )
    .get(`TXXX.${trackIdName}`, songId || relativePath);
  return row
    ? { hash: row.audio_hash, mbid: row.mb_track_id, spotify: row.spotify, path: row.path }
    : { hash: null, mbid: null, spotify: null, path: relativePath };
};

// the path of a file relative to the music directory
const libraryPath = (config, file) =>
  path.relative(path.resolve(_.get(config, 'mpd.baseDirectory', '/')), path.resolve(file));

/**
 * Appends entries for one song to the log: { kind, field, value, previous } each, with the song's
 * identity, this computer, the time, and the run. origin marks entries that apply another computer's.
 */
const recordChanges = (
  db,
  { config, song, entries, runId = null, origin = null, now = new Date() }
) => {
  if (entries.length === 0) {
    return 0;
  }
  const insert = db.prepare(
    `INSERT INTO changes (at, host, song_hash, song_mbid, song_spotify, song_path, kind, field, value,
       previous, run_id, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const at = now.toISOString();
  const host = hostName(config);
  entries.forEach(({ kind, field = null, value = null, previous = null }) =>
    insert.run(
      at,
      host,
      song.hash,
      song.mbid,
      song.spotify,
      song.path,
      kind,
      field,
      value,
      previous,
      runId,
      origin
    )
  );
  return entries.length;
};

// a spotify_matches row as the log keeps it: the decision, not when it was looked up
const matchDecision = row =>
  row
    ? JSON.stringify(_.pick(row, ['status', 'track_id', 'source', 'reviewed_at', 'rejected']))
    : null;

module.exports = {
  fieldChanges,
  fieldValues,
  hostName,
  libraryPath,
  matchDecision,
  recordChanges,
  songIdentity
};
