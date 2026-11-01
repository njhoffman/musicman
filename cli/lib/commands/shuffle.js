const _ = require('lodash');
const fs = require('fs');
const os = require('os');

const { getFilteredFiles, reportErrors } = require('./common.js');
const { getMeta, openLibrary, setMeta } = require('../db/index.js');
const { matchingPaths } = require('../db/search.js');
const { spotifyPlayer } = require('../player/players.js');
const parseFilters = require('../parser/options/filters.js');
const {
  ensurePlaylist,
  replaceTracks,
  shuffleOrder,
  spotifySourceTracks
} = require('../spotify/shuffle.js');
const { lazyUserClient } = require('../spotify/userClient.js');
const { localSpotifyIds } = require('../sync/plan.js');
const logger = require('../utils/logger.js');

// database meta keys: the last source shuffled (reshuffled by musicman shuffle without one, and the
// menu), and the id of the playlist written to
const lastSourceKey = 'shuffle.lastSource';
const playlistIdKey = 'shuffle.playlistId';

const defaultPlaylistName = 'musicman shuffle';

// terms that are all library filters on configured fields (rating:4.5, grouping:Dubstep.Singles,
// ~mood:Sad) or a rating; a playlist URL (https:) or URI (spotify:playlist:) is not
const isFilterTerms = (terms, config) => {
  const fields = new Set(['rating', ..._.map(_.get(config, 'library.tags'), 'name')]);
  return (
    terms.length > 0 &&
    _.every(terms, term => {
      const match = /^~?(\w+):/.exec(term);
      return (match && fields.has(match[1])) || /^\d+(?:\.\d+)?$/.test(term);
    })
  );
};

const sourceLabel = terms => terms.join(' ');

/**
 * Spotify ids of the library songs matching filter terms, the way search finds them. Songs without a
 * Spotify id (no TXXX.sp_track_id) are counted as skipped.
 */
const librarySourceTracks = async ({ terms, config, db }) => {
  const filters = parseFilters(terms, config, 'shuffle');
  const files = await getFilteredFiles({
    target: config.mpd.baseDirectory,
    options: { switches: { recursive: true }, filters },
    config,
    prefilter: library => matchingPaths(library, { config, filters, words: [] })
  });
  const ids = localSpotifyIds(db, config);
  const found = _.map(files, ([file]) => ids.get(file) || null);
  return {
    name: sourceLabel(terms),
    trackIds: _.uniq(_.compact(found)),
    skipped: found.length - _.compact(found).length,
    total: found.length
  };
};

const openDb = config => {
  if (!fs.existsSync(config.db.path)) {
    throw new Error(`No library database at ${config.db.path}, run: musicman db --update`);
  }
  return openLibrary(config);
};

// the last source shuffled, as terms, or null
const lastSource = db => _.get(getMeta(db, lastSourceKey), 'terms') || null;

// most tracks started in one play request; Spotify does not document a limit, so a request it refuses
// is retried with half as many, down to minPlayTracks
const maxPlayTracks = 1000;
const minPlayTracks = 100;

// the Spotify Connect device to play on: the active one, else this computer's desktop app
const playDevice = async (client, hostname = os.hostname()) => {
  const { devices = [] } = (await client.get('/me/player/devices')) || {};
  return (
    _.find(devices, 'is_active') ||
    _.find(devices, ({ name }) => _.toLower(name) === _.toLower(hostname)) ||
    null
  );
};

/**
 * Plays the first tracks of order as a list (not the playlist) with shuffle off, through the Web API
 * (Premium, the playback scopes). A playlist rewritten moments ago still plays its previous order, from
 * the app's copy, for a minute or more; a list of tracks is played exactly as sent. Resolves to
 * { device, count }.
 */
const playTracks = async (client, order, { hostname } = {}) => {
  const device = await playDevice(client, hostname);
  if (!device) {
    throw new Error('no Spotify Connect device is available');
  }
  const deviceQuery = `device_id=${encodeURIComponent(device.id)}`;
  await client.request('PUT', `/me/player/shuffle?state=false&${deviceQuery}`);
  let count = Math.min(order.length, maxPlayTracks);
  for (;;) {
    try {
      await client.request('PUT', `/me/player/play?${deviceQuery}`, {
        uris: _.map(order.slice(0, count), id => `spotify:track:${id}`),
        offset: { position: 0 },
        position_ms: 0
      });
      return { device: device.name, count };
    } catch (err) {
      if (![400, 413].includes(err.status) || count <= minPlayTracks) {
        throw err;
      }
      count = Math.max(minPlayTracks, Math.floor(count / 2));
    }
  }
};

/**
 * Starts the new order: as a list of tracks through the Web API, else (no device, no Premium) by
 * opening the playlist in the desktop app, which can play its old order for a while after a rewrite.
 * Resolves to 'api', 'mpris', or false (warned) when neither starts it.
 */
const playInOrder = async ({ client, player, order, playlistId, name, hostname }) => {
  try {
    const { device, count } = await playTracks(client, order, { hostname });
    logger.info(
      count < order.length
        ? `Playing the first ${count} of ${order.length} tracks in order on ${device}, Spotify shuffle off; '${name}' holds all of them`
        : `Playing all ${count} tracks in order on ${device}, Spotify shuffle off`
    );
    return 'api';
  } catch (err) {
    logger.debug(`Spotify Web API playback failed (${err.message}), opening the playlist instead`);
  }
  try {
    await player.shuffle('off');
    await player.open(`spotify:playlist:${playlistId}`);
    // the app can restore shuffle when it switches context, so it is turned off once more
    await player.shuffle('off');
    logger.warn(
      `Opened '${name}' in the desktop app; right after a reshuffle it can play the previous order for a minute or more`
    );
    return 'mpris';
  } catch (err) {
    logger.warn(`Spotify did not start the playlist (${err.message}), play '${name}' yourself`);
    return false;
  }
};

/**
 * shuffle [source]: writes the tracks of a source in uniformly random order into one playlist of your
 * own (shuffle.playlist, created when missing) and plays it with Spotify's shuffle off. Sources are
 * liked (Liked Songs), a playlist URL, URI or name, or library filters (rating:4.5 grouping:X). Without
 * a source the last one is shuffled again. Playback starts as a list of the first tracks (see playTracks),
 * the playlist keeps the whole order for later.
 */
const shuffleCommand = async ({
  options = {},
  config,
  env = process.env,
  db: givenDb,
  client: getClient = lazyUserClient(config, env),
  player = spotifyPlayer(),
  readLibrary = librarySourceTracks,
  random = Math.random,
  hostname = os.hostname()
}) => {
  const dryRun = Boolean(_.get(options, 'switches.dryRun'));
  const db = givenDb || openDb(config);
  const terms = _.isEmpty(options.terms) ? lastSource(db) : options.terms;
  if (!terms) {
    throw new Error(
      'musicman shuffle needs a source the first time: liked, a playlist name or URL, or library filters like rating:4.5'
    );
  }

  const source = isFilterTerms(terms, config)
    ? await readLibrary({ terms, config, db })
    : await spotifySourceTracks(getClient(), sourceLabel(terms));
  if (source.skipped > 0) {
    logger.info(
      `${source.skipped} of ${source.total} songs in ${source.name} left out: ` +
        (isFilterTerms(terms, config)
          ? 'no Spotify id (musicman sync --match)'
          : 'local files or unavailable on Spotify')
    );
  }
  if (source.trackIds.length === 0) {
    logger.warn(`No Spotify tracks to shuffle in ${source.name}`);
    return { source, written: false };
  }

  const order = shuffleOrder(source.trackIds, random);
  const playlistName = _.get(config, 'shuffle.playlist') || defaultPlaylistName;
  if (dryRun) {
    logger.info(
      `Would write ${order.length} tracks of ${source.name} in random order to '${playlistName}'`
    );
    return { source, order, written: false };
  }

  const client = getClient();
  const playlist = await ensurePlaylist(client, {
    name: playlistName,
    knownId: getMeta(db, playlistIdKey),
    description: 'Written in random order by musicman shuffle; play it with shuffle off.'
  });
  if (playlist.created) {
    logger.info(`Created the private playlist '${playlistName}'`);
  }
  await replaceTracks(client, playlist.id, order);
  setMeta(db, playlistIdKey, playlist.id);
  setMeta(db, lastSourceKey, { terms, name: source.name });
  logger.info(
    `Wrote ${order.length} tracks of ${source.name} in random order to '${playlistName}'`
  );

  const playing = await playInOrder({
    client,
    player,
    order,
    playlistId: playlist.id,
    name: playlistName,
    hostname
  });
  return { source, order, playlistId: playlist.id, written: true, playing };
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'shuffle',
  description:
    'Write a Spotify source in random order to your shuffle playlist and play it with shuffle off',
  usage: 'musicman shuffle [liked | playlist name or URL | field:value ...]',
  switches: ['dry-run'],
  completes: ['filters'],
  func: reportErrors(shuffleCommand),
  run: shuffleCommand,
  defaultTarget,
  targetArgs: false,
  isFilterTerms,
  lastSource,
  lastSourceKey,
  librarySourceTracks
};
