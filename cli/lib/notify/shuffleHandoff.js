const _ = require('lodash');

const { getMeta } = require('../db/database.js');
const logger = require('../utils/logger.js');
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
 * Returns onTrack({ player, status }) for the notify daemon, resolving to 'queued', 'handed', or null;
 * onTrack.pending() tells whether the latest shuffle still has a step to take (pollHandoff asks it).
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

  const onTrack = async ({ player, status }) => {
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

  onTrack.pending = () => {
    const { order, started } = read();
    return Boolean(
      started &&
      _.isArray(order) &&
      started.count < order.length &&
      steps.get(started.startedAt) !== 'handed'
    );
  };

  return onTrack;
};

// seconds between polls of the Web API: shorter than any track, so the last listed one is seen playing
const pollSeconds = 30;

/**
 * Follows a shuffle played without the desktop app (on the phone alone), which MPRIS cannot see: every
 * pollSeconds, while the handoff has a step to take and the desktop app plays nothing, asks the Web API
 * what plays elsewhere (remote, spotifyConnectPlayer) and gives it to the handoff. No calls otherwise.
 * Returns stop(). Dependencies: handoff (shuffleHandoff), local (spotifyPlayer), remote, setTimer.
 */
const pollHandoff = ({
  handoff,
  local,
  remote,
  interval = pollSeconds * 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) => {
  let timer = null;
  let stopped = false;
  const poll = async () => {
    if (!handoff.pending()) {
      return null;
    }
    // the desktop app (also mirroring the phone) is followed through MPRIS
    if ((await local.state()).state === 'playing') {
      return null;
    }
    const status = await remote.state();
    if (status.state !== 'playing' || !_.get(status, 'track.trackId')) {
      return null;
    }
    return handoff({ player: remote, status });
  };
  const tick = async () => {
    await poll().catch(err => logger.error(`Following the shuffle on Spotify: ${err.message}`));
    if (!stopped) {
      timer = setTimer(tick, interval);
    }
  };
  timer = setTimer(tick, interval);
  return () => {
    stopped = true;
    clearTimer(timer);
  };
};

module.exports = { pollHandoff, pollSeconds, shuffleHandoff };
