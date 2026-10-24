const _ = require('lodash');
const Promise = require('bluebird');

const { likedId } = require('./targets.js');
const { recordSpotify } = require('../history/journal.js');

// most ids per Liked Songs request and most uris per playlist request the Web API accepts
const likedBatch = 50;
const playlistBatch = 100;

// playlist items endpoints were renamed from /tracks to /items; fall back when /items is not found.
// position (adding only) inserts the items there instead of at the end
const playlistRequest = async (client, method, id, items, { position } = {}) => {
  const added = { uris: _.map(items, 'uri'), ...(_.isNil(position) ? {} : { position }) };
  try {
    return await client.request(
      method,
      `/playlists/${id}/items`,
      method === 'DELETE' ? { items } : added
    );
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
    return client.request(
      method,
      `/playlists/${id}/tracks`,
      method === 'DELETE' ? { tracks: items } : added
    );
  }
};

const uri = trackId => ({ uri: `spotify:track:${trackId}` });

/**
 * Applies a sync plan (syncPlan): adds songs to Liked Songs and playlists, and with prune removes
 * tracks whose local song no longer belongs. Each request that succeeds is recorded for musicman undo.
 * Returns the number of tracks added and removed per target.
 */
const pushPlan = async (client, plan, { prune = false, onTarget = _.noop } = {}) => {
  const results = [];
  await Promise.each(plan, async target => {
    const addIds = _.uniq(_.map(target.add, 'trackId'));
    // tracks rejected in review are always removed, other tracks only with prune
    const removeIds = _.uniq([
      ..._.map(target.reject || [], 'track_id'),
      ...(prune ? _.map(target.prune, 'track_id') : [])
    ]);
    const recorded = (action, request) => async ids => {
      await request(ids);
      recordSpotify({ target, action, trackIds: ids });
    };
    if (target.id === likedId) {
      await Promise.each(
        _.chunk(addIds, likedBatch),
        recorded('add', ids => client.request('PUT', '/me/tracks', { ids }))
      );
      await Promise.each(
        _.chunk(removeIds, likedBatch),
        recorded('remove', ids => client.request('DELETE', '/me/tracks', { ids }))
      );
    } else {
      await Promise.each(
        _.chunk(addIds, playlistBatch),
        recorded('add', ids => playlistRequest(client, 'POST', target.id, ids.map(uri)))
      );
      await Promise.each(
        _.chunk(removeIds, playlistBatch),
        recorded('remove', ids => playlistRequest(client, 'DELETE', target.id, ids.map(uri)))
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

module.exports = { likedBatch, playlistBatch, playlistRequest, pushPlan, uri };
