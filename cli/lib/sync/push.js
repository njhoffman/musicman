const _ = require('lodash');
const Promise = require('bluebird');

const { likedId } = require('./targets.js');

// most ids per Liked Songs request and most uris per playlist request the Web API accepts
const likedBatch = 50;
const playlistBatch = 100;

// playlist items endpoints were renamed from /tracks to /items; fall back when /items is not found
const playlistRequest = async (client, method, id, items) => {
  try {
    return await client.request(
      method,
      `/playlists/${id}/items`,
      method === 'DELETE' ? { items } : { uris: _.map(items, 'uri') }
    );
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
    return client.request(
      method,
      `/playlists/${id}/tracks`,
      method === 'DELETE' ? { tracks: items } : { uris: _.map(items, 'uri') }
    );
  }
};

const uri = trackId => ({ uri: `spotify:track:${trackId}` });

/**
 * Applies a sync plan (syncPlan): adds songs to Liked Songs and playlists, and with prune removes
 * tracks whose local song no longer belongs. Returns the number of tracks added and removed per target.
 */
const pushPlan = async (client, plan, { prune = false, onTarget = _.noop } = {}) => {
  const results = [];
  await Promise.each(plan, async target => {
    const addIds = _.uniq(_.map(target.add, 'trackId'));
    const removeIds = prune ? _.uniq(_.map(target.prune, 'track_id')) : [];
    if (target.id === likedId) {
      await Promise.each(_.chunk(addIds, likedBatch), ids =>
        client.request('PUT', '/me/tracks', { ids })
      );
      await Promise.each(_.chunk(removeIds, likedBatch), ids =>
        client.request('DELETE', '/me/tracks', { ids })
      );
    } else {
      await Promise.each(_.chunk(addIds, playlistBatch), ids =>
        playlistRequest(client, 'POST', target.id, ids.map(uri))
      );
      await Promise.each(_.chunk(removeIds, playlistBatch), ids =>
        playlistRequest(client, 'DELETE', target.id, ids.map(uri))
      );
    }
    const result = {
      id: target.id,
      name: target.name,
      added: addIds.length,
      removed: removeIds.length
    };
    results.push(result);
    onTarget(result);
  });
  return results;
};

module.exports = { pushPlan };
