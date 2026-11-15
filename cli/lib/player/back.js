const _ = require('lodash');
const os = require('os');

const { getMeta, setMeta } = require('../db/database.js');
const {
  backKey,
  orderKey,
  playDevice,
  playlistIdKey,
  startedKey
} = require('../commands/shuffle.js');

/**
 * The back point: what played before `musicman player play <terms>` replaced it (a side trip), so
 * `musicman player back` can return there. Stored in the database meta under backKey as
 *   { source: 'mpd' | 'spotify', savedAt, track: { title, artist }, mpd | spotify, side: { source, ids } }
 * where mpd is an mpdPlayer snapshot, spotify what restoreSpotify plays, and side the songs the side trip
 * played (absolute files on MPD, track ids on Spotify). A play while a side trip still plays keeps the
 * point, so several side trips in a row return to where the first one started. musicman shuffle (a new
 * main list) and going back clear it.
 */

const playingStates = ['playing', 'paused'];

// what identifies the song a player plays among the ids of a side trip
const songId = (source, track) => (source === 'mpd' ? track.file : track.trackId) || null;

// whether the player still plays the side trip of point
const onSideTrip = (point, player, status) => {
  const side = point && point.side;
  if (!side || side.source !== player.source || !status.track) {
    return false;
  }
  const id = songId(player.source, status.track);
  return Boolean(id) && _.includes(side.ids, id);
};

/**
 * Where Spotify plays, from GET /me/player, as restoreSpotify takes it, or null when nothing plays:
 * a context (playlist, album, artist, Liked Songs) with the track and progress; the shuffle playlist at
 * the track's place in the order for a musicman shuffle started as a list; else, for another list
 * without a context, the track playing and Spotify's queue after it (the Web API shows about 20).
 */
const captureSpotify = async (client, { order = [], playlistId = null } = {}) => {
  const playing = await client.get('/me/player');
  const item = playing && playing.item;
  if (!item || !item.uri) {
    return null;
  }
  const base = {
    trackUri: item.uri,
    progressMs: playing.progress_ms || 0,
    shuffle: _.isBoolean(playing.shuffle_state) ? playing.shuffle_state : null,
    repeat: playing.repeat_state || null
  };
  const contextUri = _.get(playing, 'context.uri');
  if (contextUri) {
    return { ...base, contextUri };
  }
  const index = item.id ? _.indexOf(order || [], item.id) : -1;
  if (index >= 0 && playlistId) {
    return {
      ...base,
      contextUri: `spotify:playlist:${playlistId}`,
      offset: index,
      shuffleList: true
    };
  }
  const { queue = [] } = (await client.get('/me/player/queue')) || {};
  return { ...base, uris: _.uniq([item.uri, ..._.compact(_.map(queue, 'uri'))]) };
};

/**
 * Plays a captured Spotify point on the active Connect device (else this computer's app): its context
 * at the track (by place for the shuffle playlist, by uri otherwise, from the start of the context when
 * Spotify refuses the uri, as for local files), or its list; then shuffle and repeat as they were.
 * Resolves to the device name.
 */
const restoreSpotify = async (client, point, { hostname = os.hostname() } = {}) => {
  const device = await playDevice(client, hostname);
  if (!device) {
    throw new Error('no Spotify Connect device is available');
  }
  const query = `device_id=${encodeURIComponent(device.id)}`;
  // shuffle off first, so the track plays where it was and the order after it is the context's
  await client.request('PUT', `/me/player/shuffle?state=false&${query}`);
  if (point.contextUri) {
    const offset = _.isNumber(point.offset) ? { position: point.offset } : { uri: point.trackUri };
    try {
      await client.request('PUT', `/me/player/play?${query}`, {
        context_uri: point.contextUri,
        offset,
        position_ms: point.progressMs || 0
      });
    } catch (err) {
      if (![400, 404].includes(err.status)) {
        throw err;
      }
      await client.request('PUT', `/me/player/play?${query}`, { context_uri: point.contextUri });
    }
  } else {
    await client.request('PUT', `/me/player/play?${query}`, {
      uris: point.uris,
      offset: { position: 0 },
      position_ms: point.progressMs || 0
    });
  }
  if (point.shuffle) {
    await client.request('PUT', `/me/player/shuffle?state=true&${query}`);
  }
  if (point.repeat) {
    await client.request('PUT', `/me/player/repeat?state=${point.repeat}&${query}`);
  }
  return device.name;
};

/**
 * Before a side trip replaces what player plays: resolves to { keep: true } when it plays the side
 * trip of the saved point (or plays nothing), else to { point } with what it plays now. Throws when
 * that cannot be read (the caller warns and keeps the saved point).
 */
const captureBack = async ({ db, player, status, client }) => {
  const saved = getMeta(db, backKey);
  if (!status.track || !playingStates.includes(status.state) || onSideTrip(saved, player, status)) {
    return { keep: true };
  }
  const base = {
    source: player.source,
    savedAt: new Date().toISOString(),
    track: { title: status.track.title || '', artist: status.track.artist || '' }
  };
  if (player.source === 'mpd') {
    return { point: { ...base, mpd: await player.snapshot() } };
  }
  const spotify = await captureSpotify(client(), {
    order: getMeta(db, orderKey),
    playlistId: getMeta(db, playlistIdKey)
  });
  return spotify ? { point: { ...base, spotify } } : { keep: true };
};

/**
 * After the side trip started: stores the captured point (or keeps the saved one) with the songs the
 * side trip plays; a kept point adds them to its side trip. Returns the point stored, or null.
 */
const commitBack = (db, captured, side) => {
  const point = captured && captured.point ? captured.point : getMeta(db, backKey);
  if (!point) {
    return null;
  }
  const kept = !(captured && captured.point);
  const sameSide = kept && point.side && point.side.source === side.source;
  const stored = {
    ...point,
    side: { source: side.source, ids: _.uniq([...(sameSide ? point.side.ids : []), ...side.ids]) }
  };
  setMeta(db, backKey, stored);
  return stored;
};

/**
 * Returns to the back point and clears it: MPD gets its queue, modes, song, and time back; Spotify its
 * context or list, track, progress, shuffle, and repeat. Throws when there is none. Resolves to
 * { source, track, ... } with what the restore reports. Dependencies: mpd (mpdPlayer), client().
 */
const goBack = async ({ db, mpd, client, hostname }) => {
  const point = getMeta(db, backKey);
  if (!point) {
    throw new Error(
      'Nothing to go back to: musicman player play <terms> remembers what played before it'
    );
  }
  let restored;
  if (point.source === 'mpd') {
    if (!mpd) {
      throw new Error('MPD is not available');
    }
    restored = await mpd.restore(point.mpd);
  } else {
    restored = { device: await restoreSpotify(client(), point.spotify, { hostname }) };
    if (point.spotify.shuffleList) {
      // the shuffle playlist plays the whole order now, nothing is left for the daemon to hand off
      setMeta(db, startedKey, null);
    }
  }
  setMeta(db, backKey, null);
  return { source: point.source, track: point.track, ...restored };
};

module.exports = {
  backKey,
  captureBack,
  captureSpotify,
  commitBack,
  goBack,
  onSideTrip,
  restoreSpotify
};
