const _ = require('lodash');
const path = require('path');

const { transaction } = require('../db/database.js');
const { spotifyIdFrame } = require('./match.js');
const { likedId } = require('./targets.js');

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
 *   spotifyRemoved: belongs by its tags, is not in the target, and was in sync before (removed on Spotify)
 *   inSync: track ids in the target that belong there
 * and noId (songs that belong without a Spotify id) and pull (tracks in the target not in the library).
 */
const syncPlan = (db, config, songs) => {
  const ids = localSpotifyIds(db, config);
  const songByTrack = new Map(_.map([...ids], ([file, id]) => [id, file]));
  const synced = syncedTracks(db);
  const playlists = db.prepare('SELECT id, name FROM spotify_playlists').all();
  const tracksOf = db.prepare(
    'SELECT track_id, is_local, name, artists, album FROM spotify_playlist_tracks WHERE playlist_id = ?'
  );

  return _.map(playlists, ({ id, name }) => {
    const remote = tracksOf.all(id);
    const remoteIds = new Set(_.compact(_.map(remote, 'track_id')));
    const before = synced[id] || new Set();
    const members = _.filter(songs, ({ targets }) => targets.includes(id));
    const memberFiles = new Set(_.map(members, 'file'));

    const withId = _.map(
      _.filter(members, ({ file }) => ids.has(file)),
      song => ({ ...song, trackId: ids.get(song.file) })
    );
    const missing = _.filter(withId, ({ trackId }) => !remoteIds.has(trackId));
    const [spotifyRemoved, add] = _.partition(missing, ({ trackId }) => before.has(trackId));
    const extra = _.map(
      _.filter(remote, ({ track_id: trackId }) => {
        const file = trackId && songByTrack.get(trackId);
        return file && !memberFiles.has(file);
      }),
      track => ({ ...track, file: songByTrack.get(track.track_id) })
    );
    const [prune, spotifyAdded] = _.partition(extra, ({ track_id: trackId }) =>
      before.has(trackId)
    );

    return {
      id,
      name: id === likedId ? 'Liked Songs' : name,
      remote: remote.length,
      local: members.length,
      add,
      noId: _.filter(members, ({ file }) => !ids.has(file)),
      prune,
      spotifyAdded,
      spotifyRemoved,
      inSync: _.uniq(
        _.map(
          _.filter(withId, ({ trackId }) => remoteIds.has(trackId)),
          'trackId'
        )
      ),
      pull: _.filter(
        remote,
        ({ track_id: trackId, is_local: isLocal }) =>
          !isLocal && trackId && !songByTrack.has(trackId)
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
        ..._.map(target.prune, 'track_id'),
        ..._.map(target.spotifyRemoved, 'trackId')
      ];
      _.uniq(keep).forEach(trackId => insert.run(target.id, trackId));
    })
  );
};

module.exports = { localSpotifyIds, recordSynced, syncPlan, syncedTracks };
