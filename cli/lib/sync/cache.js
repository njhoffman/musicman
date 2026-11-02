const _ = require('lodash');

const { transaction } = require('../db/database.js');
const { likedId } = require('./targets.js');

// fields kept from playlist items, the track is under item (current API) or track (older responses)
const trackFields = 'id,name,duration_ms,artists(name),album(name),external_ids(isrc)';
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
    added_at: entry.added_at || null,
    isrc: _.get(track, 'external_ids.isrc') || null
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
         (playlist_id, track_id, is_local, name, artists, album, duration_ms, added_at, isrc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        row.added_at,
        row.isrc
      )
    );
  });

/**
 * Refreshes the cached tracks of one playlist, unless its snapshot_id did not change since the last
 * refresh. Resolves to 'refreshed' with the track count, or 'unchanged'.
 */
const refreshPlaylist = async (db, client, id, { onPage = _.noop } = {}) => {
  const cached = db.prepare('SELECT snapshot_id FROM spotify_playlists WHERE id = ?').get(id);
  const playlist = await client.get(`/playlists/${id}?fields=name,snapshot_id`);
  if (playlist.snapshot_id && playlist.snapshot_id === _.get(cached, 'snapshot_id')) {
    return { status: 'unchanged', name: playlist.name };
  }
  const items = await client.paginate(
    `/playlists/${id}/items?limit=100&fields=${encodeURIComponent(itemFields)}`,
    { onPage: (fetched, total) => onPage(playlist.name, fetched, total) }
  );
  storePlaylist(db, {
    id,
    name: playlist.name,
    snapshotId: playlist.snapshot_id,
    rows: _.map(items, toRow)
  });
  return { status: 'refreshed', count: items.length, name: playlist.name };
};

/**
 * Refreshes the local cache of Liked Songs and the playlists in playlistIds. Playlists whose
 * snapshot_id did not change since the last refresh are not fetched again. onTarget(id, status,
 * count) is called after each target; onProgress({ done, total, name, fetched, tracks }) while it
 * works: targets done of total, and the tracks fetched of the one being fetched (name).
 */
const refreshCache = async (
  db,
  client,
  playlistIds,
  { onTarget = _.noop, onProgress = _.noop } = {}
) => {
  const summary = { refreshed: [], unchanged: [] };
  const ids = _.uniq(playlistIds);
  const total = ids.length + 1;
  let done = 0;
  const pageProgress = (name, fetched, tracks) =>
    onProgress({ done, total, name, fetched, tracks });
  pageProgress('Liked Songs', 0, null);

  const liked = await client.paginate('/me/tracks?limit=50', {
    onPage: (fetched, tracks) => pageProgress('Liked Songs', fetched, tracks)
  });
  storePlaylist(db, {
    id: likedId,
    name: 'Liked Songs',
    snapshotId: null,
    rows: _.map(liked, toRow)
  });
  summary.refreshed.push(likedId);
  done += 1;
  onTarget(likedId, 'refreshed', liked.length);
  onProgress({ done, total, name: 'Liked Songs', fetched: liked.length, tracks: liked.length });

  for (const id of ids) {
    const { status, count, name } = await refreshPlaylist(db, client, id, { onPage: pageProgress });
    summary[status].push(id);
    done += 1;
    onTarget(id, status, count);
    onProgress({ done, total, name: name || id, fetched: count || 0, tracks: count || 0 });
  }
  return summary;
};

module.exports = { itemFields, refreshCache, refreshPlaylist, toRow };
