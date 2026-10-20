const _ = require('lodash');
const path = require('path');

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

/**
 * What it takes to bring each Spotify target (Liked Songs and mapped playlists) in line with the
 * library, from the cache and the songs' targets (songTargets):
 *   add: songs that belong in the target and have a Spotify id, but are not in it
 *   noId: songs that belong in the target without a Spotify id (need sync --match or an upload)
 *   prune: tracks in the target whose local song no longer belongs there
 *   pull: tracks in the target that are not in the library
 */
const syncPlan = (db, config, songs) => {
  const ids = localSpotifyIds(db, config);
  const songByTrack = new Map(_.map([...ids], ([file, id]) => [id, file]));
  const playlists = db.prepare('SELECT id, name FROM spotify_playlists').all();
  const tracksOf = db.prepare(
    'SELECT track_id, is_local, name, artists, album FROM spotify_playlist_tracks WHERE playlist_id = ?'
  );

  return _.map(playlists, ({ id, name }) => {
    const remote = tracksOf.all(id);
    const remoteIds = new Set(_.compact(_.map(remote, 'track_id')));
    const members = _.filter(songs, ({ targets }) => targets.includes(id));
    const memberFiles = new Set(_.map(members, 'file'));

    const add = _.filter(members, ({ file }) => ids.has(file) && !remoteIds.has(ids.get(file))).map(
      song => ({
        ...song,
        trackId: ids.get(song.file)
      })
    );
    const noId = _.filter(members, ({ file }) => !ids.has(file));
    const prune = _.filter(remote, ({ track_id: trackId }) => {
      const file = trackId && songByTrack.get(trackId);
      return file && !memberFiles.has(file);
    });
    const pull = _.filter(
      remote,
      ({ track_id: trackId, is_local: isLocal }) => !isLocal && trackId && !songByTrack.has(trackId)
    );

    return {
      id,
      name: id === likedId ? 'Liked Songs' : name,
      remote: remote.length,
      local: members.length,
      add,
      noId,
      prune,
      pull
    };
  });
};

module.exports = { localSpotifyIds, syncPlan };
