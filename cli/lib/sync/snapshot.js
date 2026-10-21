const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');

const { toRow } = require('./cache.js');
const { likedId, playlistTargets } = require('./targets.js');

// fields kept from playlist items, the track is under item (current API) or track (older responses)
const trackFields = 'id,name,uri,duration_ms,artists(name),album(name)';
const itemFields = `items(added_at,is_local,item(${trackFields}),track(${trackFields})),next`;

const snapshotDirectory = config =>
  path.join(_.get(config, 'db.backupDirectory') || config.mpd.baseDirectory, 'spotify');

const stamp = now =>
  now
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');

/**
 * Saves the current contents of Liked Songs and every mapped playlist, fetched fresh from Spotify, to
 * <db.backupDirectory>/spotify/<time>.json: per target its name, snapshot id, and tracks in order with
 * their id, name, artists, album, and when they were added. Returns the file and per target counts.
 */
const saveSnapshot = async (client, config, { now = new Date(), onTarget = _.noop } = {}) => {
  const targets = [];
  const liked = await client.paginate('/me/tracks?limit=50');
  targets.push({ id: likedId, name: 'Liked Songs', snapshotId: null, tracks: _.map(liked, toRow) });
  onTarget(likedId, liked.length);

  await Promise.each(_.uniq(_.map(playlistTargets(config), 'id')), async id => {
    const playlist = await client.get(`/playlists/${id}?fields=name,snapshot_id`);
    const items = await client.paginate(
      `/playlists/${id}/items?limit=100&fields=${encodeURIComponent(itemFields)}`
    );
    targets.push({
      id,
      name: playlist.name,
      snapshotId: playlist.snapshot_id,
      tracks: _.map(items, toRow)
    });
    onTarget(id, items.length);
  });

  const directory = snapshotDirectory(config);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${stamp(now)}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ savedAt: now.toISOString(), targets }, null, 2)}\n`);
  return {
    file,
    targets: _.map(targets, ({ id, name, tracks }) => ({ id, name, tracks: tracks.length }))
  };
};

module.exports = { saveSnapshot, snapshotDirectory };
