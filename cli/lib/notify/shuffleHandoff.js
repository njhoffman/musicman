const _ = require('lodash');

const { getMeta } = require('../db/database.js');
// meta keys musicman shuffle writes: the order, and the tracks it started
const { orderKey, startedKey } = require('../commands/shuffle.js');

/**
 * Continues a musicman shuffle past the tracks it started as a list (at most 1000; a rewritten
 * playlist plays its previous order for a minute or more, so the list is played instead). The playlist
 * holds the whole order, current by the time the list ends, so the rest plays from it:
 *   - when the last listed track starts, the next track of the order is queued, so playback goes on;
 *   - when that queued track starts, playback moves to the shuffle playlist at that track and position,
 *     unless the playlist is what plays already.
 * Each step is taken once per shuffle (by its startedAt), and only for the latest shuffle's tracks.
 * Returns onTrack({ player, status }) for the notify daemon, resolving to 'queued', 'handed', or null.
 * Dependencies: openDb() the library database or null, client() the Spotify user client.
 */
const shuffleHandoff = ({ openDb, client }) => {
  const steps = new Map();

  const read = () => {
    const db = openDb();
    if (!db) {
      return {};
    }
    try {
      return { order: getMeta(db, orderKey), started: getMeta(db, startedKey) };
    } finally {
      db.close();
    }
  };

  return async ({ player, status }) => {
    const trackId = _.get(status, 'track.trackId');
    if (player.source !== 'spotify' || !trackId) {
      return null;
    }
    const { order, started } = read();
    if (!started || !_.isArray(order) || started.count >= order.length) {
      return null;
    }
    const key = started.startedAt;
    const index = order.indexOf(trackId);
    if (index === started.count - 1 && !steps.has(key)) {
      steps.set(key, 'queued');
      await client().request(
        'POST',
        `/me/player/queue?uri=${encodeURIComponent(`spotify:track:${order[started.count]}`)}`
      );
      return 'queued';
    }
    if (index === started.count && steps.get(key) !== 'handed') {
      steps.set(key, 'handed');
      const playlistUri = `spotify:playlist:${started.playlistId}`;
      const playing = (await client().get('/me/player')) || {};
      if (_.get(playing, 'context.uri') === playlistUri) {
        return null;
      }
      const progress = _.isNumber(playing.progress_ms)
        ? playing.progress_ms
        : Math.round((_.get(status, 'track.position') || 0) * 1000);
      await client().request('PUT', '/me/player/play', {
        context_uri: playlistUri,
        offset: { position: started.count },
        position_ms: progress
      });
      return 'handed';
    }
    return null;
  };
};

module.exports = { shuffleHandoff };
