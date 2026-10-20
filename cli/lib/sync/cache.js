const _ = require('lodash');
const Promise = require('bluebird');

const { transaction } = require('../db/database.js');
const { likedId } = require('./targets.js');

// fields kept from playlist items, the track is under item (current API) or track (older responses)
const trackFields = 'id,name,duration_ms,artists(name),album(name)';
const itemFields = `items(added_at,is_local,item(${trackFields}),track(${trackFields})),next`;

const toRow = entry => {
  const track = entry.item || entry.track || {};
  return {
    track_id: track.id || null,
    is_local: entry.is_local ? 1 : 0,
    name: track.name || null,
    artists: _.map(track.artists, 'name').join(', ') || null,
    album: _.get(track, 'album.name') || null,
    duration_ms: track.duration_ms || null,
    added_at: entry.added_at || null
  };
};

const storePlaylist = (db, { id, name, snapshotId, rows }) =>
  transaction(db, () => {
    db.prepare(
      `INSERT INTO spotify_playlists (id, name, snapshot_id, synced_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, snapshot_id = excluded.snapshot_id,
         synced_at = excluded.synced_at`
    ).run(id, name, snapshotId);
    db.prepare('DELETE FROM spotify_playlist_tracks WHERE playlist_id = ?').run(id);
    const insert = db.prepare(
      `INSERT INTO spotify_playlist_tracks
         (playlist_id, track_id, is_local, name, artists, album, duration_ms, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    rows.forEach(row =>
      insert.run(
        id,
        row.track_id,
        row.is_local,
        row.name,
        row.artists,
        row.album,
        row.duration_ms,
        row.added_at
      )
    );
  });

/**
 * Refreshes the local cache of Liked Songs and the playlists in playlistIds. Playlists whose
 * snapshot_id did not change since the last refresh are not fetched again.
 */
const refreshCache = async (db, client, playlistIds, { onTarget = _.noop } = {}) => {
  const cachedSnapshot = id =>
    _.get(
      db.prepare('SELECT snapshot_id FROM spotify_playlists WHERE id = ?').get(id),
      'snapshot_id'
    );
  const summary = { refreshed: [], unchanged: [] };

  const liked = await client.paginate('/me/tracks?limit=50');
  storePlaylist(db, {
    id: likedId,
    name: 'Liked Songs',
    snapshotId: null,
    rows: _.map(liked, toRow)
  });
  summary.refreshed.push(likedId);
  onTarget(likedId, 'refreshed', liked.length);

  await Promise.each(_.uniq(playlistIds), async id => {
    const playlist = await client.get(`/playlists/${id}?fields=name,snapshot_id`);
    if (playlist.snapshot_id && playlist.snapshot_id === cachedSnapshot(id)) {
      summary.unchanged.push(id);
      onTarget(id, 'unchanged');
      return;
    }
    const items = await client.paginate(
      `/playlists/${id}/items?limit=100&fields=${encodeURIComponent(itemFields)}`
    );
    storePlaylist(db, {
      id,
      name: playlist.name,
      snapshotId: playlist.snapshot_id,
      rows: _.map(items, toRow)
    });
    summary.refreshed.push(id);
    onTarget(id, 'refreshed', items.length);
  });
  return summary;
};

module.exports = { refreshCache, toRow };
