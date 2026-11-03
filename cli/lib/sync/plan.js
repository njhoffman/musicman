const _ = require('lodash');
const path = require('path');

const { transaction } = require('../db/database.js');
const { excludedTracks } = require('../db/exclusions.js');
const { confirmedFiles, exportable, localTracks } = require('./localFiles.js');
const { rejectedTracks, spotifyIdFrame } = require('./match.js');
const {
  conflictingTargets,
  exclusiveGroups,
  ignorePlaylistId,
  ignoredTracks,
  likedId
} = require('./targets.js');

// Spotify track id of every stored song, keyed by absolute file path
const localSpotifyIds = (db, config) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const rows = db
    .prepare(
      `SELECT s.path, t.value FROM song_tags t JOIN songs s ON s.id = t.song_id WHERE t.frame_id = ?`
    )
    .all(spotifyIdFrame);
  return new Map(
    _.map(rows, ({ path: songPath, value }) => [path.join(baseDirectory, songPath), value])
  );
};

// frame holding a song's Spotify ISRC: the spotify.fields entry for track.external_ids.isrc
const isrcFrame = config =>
  `TXXX.${_.get(
    _.find(_.get(config, 'spotify.fields', []), { path: 'track.external_ids.isrc' }),
    'name',
    'sp_isrc'
  )}`;

// library track id of every ISRC the library's songs have, the lowest when songs of one recording are
// linked to different tracks
const isrcTracks = (db, config) => {
  const rows = db
    .prepare(
      `SELECT i.value AS isrc, t.value AS track_id FROM song_tags i
       JOIN song_tags t ON t.song_id = i.song_id AND t.frame_id = ?
       WHERE i.frame_id = ? AND i.value != ''`
    )
    .all(spotifyIdFrame, isrcFrame(config));
  return new Map(
    _.map(_.groupBy(rows, 'isrc'), (group, isrc) => [isrc, _.min(_.map(group, 'track_id'))])
  );
};

// track ids each target and the local tags agreed on at the last sync, keyed by target id
const syncedTracks = db =>
  _.mapValues(
    _.groupBy(db.prepare('SELECT playlist_id, track_id FROM spotify_synced').all(), 'playlist_id'),
    rows => new Set(_.map(rows, 'track_id'))
  );

/**
 * What it takes to bring each Spotify target (Liked Songs and mapped playlists) and the library in line,
 * from the cache, the songs' targets (songTargets), and what the two agreed on at the last sync
 * (spotify_synced). For songs in the library:
 *   add: belongs in the target by its tags, is not in it, and was not removed on Spotify
 *   prune: in the target, no longer belongs by its tags, and was in sync before (a local change)
 *   spotifyAdded: in the target, does not belong by its tags, and was not in sync before (added on Spotify)
 * prune and spotifyAdded tracks carry every file linked to the track (files) besides the first (file);
 * a track counts as belonging when any of them does.
 *   spotifyRemoved: belongs by its tags, is not in the target, and was in sync before (removed on Spotify)
 *   inSync: track ids in the target that belong there
 *   conflict: would be add, but the copies of the song linked to the track belong in different
 *     playlists of an exclusive group (conflictingTargets), so it is added to none of them
 * and noId (songs that belong without a Spotify id, with match: their match status or null, and tags:
 * { artist, title, album, duration }), localFiles (localTracks of the noId songs Spotify has no track
 * for: added, pending, stray, with the songs confirmed by sync --export --confirm added), reject (tracks rejected in review for a song, which push removes), and pull (tracks in the target not in the library, nor in sync.ignorePlaylist).
 * Songs marked outOfScope (outside sync.scope) are in none of these.
 *
 * A track in a target that is another release of a library song (the same ISRC, e.g. the single and
 * the album track) counts as that song's track (libraryId): it is not pulled, its targets reach the song
 * through spotifyAdded, and the song is not added next to it. prune keeps its own track_id, which push
 * removes. Tracks rejected in review or in sync.ignorePlaylist are never counted as another release.
 */
const syncPlan = (db, config, songs) => {
  const ids = localSpotifyIds(db, config);
  // several files can share a track id (album and compilation copies, repeated downloads)
  const filesByTrack = _.groupBy([...ids.keys()], file => ids.get(file));
  const songByTrack = new Map(_.map(filesByTrack, (files, id) => [id, files[0]]));
  const synced = syncedTracks(db);
  // songs confirmed as added to Liked Songs, which the Web API never lists as local tracks
  const confirmedIn = confirmedFiles(config);
  // per track, the group playlists its copies disagree on (in sync.scope; outOfScope songs have none)
  const groups = exclusiveGroups(config);
  const targetsByFile = new Map(_.map(songs, ({ file, targets }) => [file, targets]));
  const conflicts = new Map(
    _.map(filesByTrack, (files, trackId) => [
      trackId,
      conflictingTargets(
        groups,
        _.map(files, file => targetsByFile.get(file) || [])
      )
    ])
  );
  const inConflict = (trackId, id) => (conflicts.get(trackId) || new Set()).has(id);
  // tracks rejected in review that no song is linked to any more, removed wherever they were pushed;
  // so are the tracks of songs taken out of the library (duplicate copies), in favor of the copy kept
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const rejected = new Map([
    ..._.map([...excludedTracks(db)], ([trackId, songPath]) => [
      trackId,
      path.join(baseDirectory, songPath)
    ]),
    ...rejectedTracks(db, config)
  ]);
  const isRejected = trackId => rejected.has(trackId) && !songByTrack.has(trackId);
  // sync.ignorePlaylist is cached like a target but is none, its tracks are never pulled
  const ignoreId = ignorePlaylistId(config);
  const ignoredIds = ignoredTracks(db, config);
  const playlists = _.reject(db.prepare('SELECT id, name FROM spotify_playlists').all(), {
    id: ignoreId
  });
  const tracksOf = db.prepare(
    `SELECT track_id, is_local, name, artists, album, isrc FROM spotify_playlist_tracks
     WHERE playlist_id = ?`
  );
  const releases = isrcTracks(db, config);
  // the match status of songs without a Spotify id: missing, review, rejected, or none (never looked up)
  // songs without a Spotify id: their match status (missing, review, rejected, or null when never
  // looked up) and the tags Spotify names a local file by
  const songOf = db.prepare(
    `SELECT s.id, s.duration, m.status FROM songs s LEFT JOIN spotify_matches m ON m.song_id = s.id
     WHERE s.path = ?`
  );
  const frameOf = db.prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ?');
  const withoutId = _.memoize(file => {
    const row = songOf.get(path.relative(baseDirectory, file));
    if (!row) {
      return { match: null, tags: {} };
    }
    const frame = id => _.get(frameOf.get(row.id, id), 'value') || null;
    return {
      match: row.status || null,
      tags: { artist: frame('TPE1'), title: frame('TIT2'), album: frame('TALB'), duration: row.duration }
    };
  });
  // the library track a remote track stands for: itself, or the song it is another release of
  const libraryId = ({ track_id: trackId, isrc }) =>
    !trackId ||
    songByTrack.has(trackId) ||
    !isrc ||
    !releases.has(isrc) ||
    rejected.has(trackId) ||
    ignoredIds.has(trackId)
      ? trackId
      : releases.get(isrc);

  return _.map(playlists, ({ id, name }) => {
    const remote = _.map(tracksOf.all(id), track => ({ ...track, libraryId: libraryId(track) }));
    const remoteIds = new Set(_.compact(_.map(remote, 'libraryId')));
    const before = synced[id] || new Set();
    const members = _.filter(songs, ({ targets }) => targets.includes(id));
    // songs outside sync.scope are left alone wherever they are on Spotify
    const ignored = new Set(_.map(_.filter(songs, 'outOfScope'), 'file'));
    const memberFiles = new Set(_.map(members, 'file'));
    const noId = _.map(
      _.filter(members, ({ file }) => !ids.has(file)),
      member => ({ ...member, ...withoutId(member.file) })
    );

    const withId = _.map(
      _.filter(members, ({ file }) => ids.has(file)),
      song => ({ ...song, trackId: ids.get(song.file) })
    );
    const missing = _.filter(withId, ({ trackId }) => !remoteIds.has(trackId));
    const [spotifyRemoved, wanted] = _.partition(missing, ({ trackId }) => before.has(trackId));
    const [conflict, add] = _.partition(wanted, ({ trackId }) => inConflict(trackId, id));
    // a track is extra only when no copy of its song belongs, and every copy is in sync.scope
    const extra = _.map(
      _.filter(remote, ({ libraryId: trackId }) => {
        const files = (trackId && filesByTrack[trackId]) || [];
        return files.length > 0 && !files.some(file => memberFiles.has(file) || ignored.has(file));
      }),
      track => ({
        ...track,
        file: songByTrack.get(track.libraryId),
        files: filesByTrack[track.libraryId]
      })
    );
    const [prune, added] = _.partition(extra, ({ libraryId: trackId }) => before.has(trackId));
    // both releases of a song in one target add its tag once
    const spotifyAdded = _.uniqBy(added, 'libraryId');

    return {
      id,
      name: id === likedId ? 'Liked Songs' : name,
      remote: remote.length,
      local: members.length,
      add,
      conflict: _.uniqBy(conflict, 'trackId'),
      noId,
      localFiles: localTracks(_.filter(noId, exportable), remote, confirmedIn(id)),
      prune,
      spotifyAdded,
      spotifyRemoved,
      inSync: _.uniq(
        _.map(
          _.filter(withId, ({ trackId }) => remoteIds.has(trackId)),
          'trackId'
        )
      ),
      reject: _.map(
        _.filter(remote, ({ track_id: trackId }) => trackId && isRejected(trackId)),
        track => ({ ...track, file: rejected.get(track.track_id) })
      ),
      pull: _.filter(
        remote,
        ({ track_id: trackId, libraryId: id, is_local: isLocal }) =>
          !isLocal &&
          trackId &&
          !songByTrack.has(id) &&
          !isRejected(trackId) &&
          !ignoredIds.has(trackId)
      )
    };
  });
};

/**
 * Stores what each target of a fresh plan and the local tags agree on as the last synced state. Tracks
 * the two still disagree on keep their previous state (prune and spotifyRemoved were in sync before,
 * add and spotifyAdded were not), so a change stays a change on the next sync until it is resolved.
 */
const recordSynced = (db, plan) => {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO spotify_synced (playlist_id, track_id) VALUES (?, ?)'
  );
  transaction(db, () =>
    _.each(plan, target => {
      db.prepare('DELETE FROM spotify_synced WHERE playlist_id = ?').run(target.id);
      const keep = [
        ...target.inSync,
        ..._.map(target.prune, track => track.libraryId || track.track_id),
        ..._.map(target.spotifyRemoved, 'trackId')
      ];
      _.uniq(keep).forEach(trackId => insert.run(target.id, trackId));
    })
  );
};

module.exports = { localSpotifyIds, recordSynced, syncPlan, syncedTracks };
