const _ = require('lodash');
const fs = require('fs');

const { createClient } = require('../spotify/api.js');
const { appTokenGetter, readTokens, userAccessToken } = require('../spotify/auth.js');
const { getCredentials, missingCredentials, tokenPath } = require('../spotify/credentials.js');
const { login } = require('../spotify/login.js');
const { readBeetsSpotifyIds } = require('../spotify/beets.js');
const { matchSongs, reviewItems, spotifyIdFrame } = require('../sync/match.js');
const { playlistTargets, songTargets } = require('../sync/targets.js');
const { refreshCache } = require('../sync/cache.js');
const { syncPlan } = require('../sync/plan.js');
const { renderColumns } = require('../output/render.js');
const { openLibrary } = require('../db/index.js');
const { getFilteredFiles } = require('./common.js');
const logger = require('../utils/logger.js');

const credentialSource = (env, name) => (env[name] ? 'environment' : 'config');

const userClient = ({ credentials, file, fetchImpl }) =>
  createClient({ getToken: () => userAccessToken({ credentials, file, fetchImpl }), fetchImpl });

const runLogin = async ({ credentials, file, fetchImpl, open }) => {
  await login({
    credentials,
    file,
    fetchImpl,
    open,
    onUrl: url => logger.info(`Log in to Spotify in the browser (opening it now): ${url}`)
  });
  // the login is complete once the token is saved, looking up the user is only informational
  try {
    const me = await userClient({ credentials, file, fetchImpl }).get('/me');
    logger.info(`Logged in to Spotify as ${me.display_name || me.id}, token saved to ${file}`);
    return { user: me.id };
  } catch (err) {
    logger.warn(
      `Logged in to Spotify, token saved to ${file}; could not look up the user: ${err.message}`
    );
    return { user: null };
  }
};

const showStatus = async ({ credentials, file, fetchImpl, env }) => {
  logger.info(
    `Spotify app: client id from ${credentialSource(env, 'SPOTIFY_CLIENT_ID')}, redirect ${
      credentials.redirectUri
    }`
  );
  if (!readTokens(file)) {
    logger.info('Not logged in, run: musicman sync --login');
    return { loggedIn: false };
  }
  const client = userClient({ credentials, file, fetchImpl });
  const me = await client.get('/me');
  logger.info(`Logged in as ${me.display_name || me.id}`);
  return { loggedIn: true, user: me.id, client };
};

// refresh the cache of Liked Songs and mapped playlists, then report what sync would change
const runPlan = async ({ client, config }) => {
  const db = openSyncLibrary(config);
  try {
    const playlistIds = _.map(playlistTargets(config), 'id');
    await refreshCache(db, client, playlistIds, {
      onTarget: (id, status, count) =>
        logger.progress(
          `Refreshing Spotify playlists: ${id} ${status}${count === undefined ? '' : ` (${count})`}`
        )
    });
    logger.progressDone();
    const plan = syncPlan(db, config, songTargets(await librarySongs(config), config));
    const rows = _.map(plan, target =>
      [
        target.name,
        target.remote,
        target.local,
        target.add.length,
        target.noId.length,
        target.prune.length,
        target.pull.length
      ].map(String)
    );
    const head = ['Target', 'Spotify', 'Local', 'Add', 'No id', 'Prune', 'Pull'];
    const columns = [{ maxWidth: 40 }, ...Array(6).fill({ align: 'right' })];
    logger.info(`\n${renderColumns({ head, rows, columns, splitter: '  ' })}`);
    const total = key => _.sumBy(plan, target => target[key].length);
    logger.info(
      `To add: ${total('add')}, without a Spotify id: ${total('noId')} (sync --match), ` +
        `to prune: ${total('prune')}, to pull: ${total('pull')}`
    );
    return { plan };
  } finally {
    db.close();
  }
};

const formatDuration = seconds =>
  seconds ? `${Math.floor(seconds / 60)}:${`${Math.round(seconds % 60)}`.padStart(2, '0')}` : '?';

// the library database is required for sync, songs and their Spotify ids are read from it
const openSyncLibrary = config => {
  if (!fs.existsSync(config.db.path)) {
    throw new Error(`No library database at ${config.db.path}, run: musicman db --update`);
  }
  return openLibrary(config);
};

const librarySongs = async config =>
  getFilteredFiles({
    target: config.mpd.baseDirectory,
    options: { switches: { recursive: true } },
    config
  });

const runMatch = async ({ credentials, file, fetchImpl, config, dryRun }) => {
  const db = openSyncLibrary(config);
  try {
    const songs = songTargets(await librarySongs(config), config);
    const summary = await matchSongs({
      db,
      config,
      songs,
      // lookups need no user, the app token avoids the user-read-private scope a market would need
      client: createClient({ getToken: appTokenGetter(credentials, { fetchImpl }), fetchImpl }),
      beetsIds: readBeetsSpotifyIds(config.sync.beetsConfig),
      dryRun,
      onProgress: ({ done, total, match, review, missing }) =>
        logger.progress(
          `Matching ${done}/${total} songs: ${match} matched, ${review} to review, ${missing} not found`
        ),
      onSong: (status, { file: songFile }, result) =>
        logger.logToFile(
          status === 'failed' ? 'warn' : 'debug',
          `${status.padEnd(7)} ${songFile}${result.candidate ? ` -> ${result.candidate.id}` : ''}${
            result.error ? `: ${result.error}` : ''
          }`
        )
    });
    logger.progressDone();
    const { bySource } = summary;
    logger.info(
      [
        `Spotify ids ${dryRun ? '(dry run, nothing written)' : ''}`.trim(),
        `  songs for Liked Songs or playlists: ${summary.targets}`,
        `  already tagged: ${summary.tagged}, recently checked: ${summary.cached}`,
        `  not in database: ${summary.notInDatabase} (run musicman db --update)`,
        `  matched: ${summary.match} (beets ${bySource.beets}, isrc ${bySource.isrc}, search ${bySource.search})`,
        `  to review: ${summary.review} (musicman sync --review)`,
        `  not found: ${summary.missing}, failed: ${summary.failed}`
      ].join('\n')
    );
    return { summary };
  } finally {
    db.close();
  }
};

const runReview = ({ config }) => {
  const db = openSyncLibrary(config);
  try {
    const items = reviewItems(db, config);
    // edit assigns tags by their library.tags name
    const tagName = _.get(_.find(config.library.tags, { id: spotifyIdFrame }), 'name');
    const accept = (songFile, id) =>
      tagName
        ? `  accept: musicman edit "${songFile}" ${tagName}=${id}`
        : `  accept: add a ${spotifyIdFrame} tag to library.tags, then edit it to ${id}`;
    if (items.length === 0) {
      logger.info('No Spotify matches waiting for review');
    }
    items.forEach(({ file: songFile, path: songPath, duration, candidate }) =>
      logger.info(
        [
          `${songPath} (${formatDuration(duration)})`,
          `  Spotify: ${candidate.artists} - ${candidate.name} [${
            candidate.album
          }] (${formatDuration(candidate.durationMs / 1000)})`,
          accept(songFile, candidate.id)
        ].join('\n')
      )
    );
    return { review: items };
  } finally {
    db.close();
  }
};

// sync: Spotify status; sync --login: log in to Spotify
const syncCommand = async ({
  options,
  config,
  fetchImpl,
  open,
  env = process.env,
  file = tokenPath(env)
}) => {
  const credentials = getCredentials(config, env);
  const missing = missingCredentials(credentials);
  if (missing.length > 0) {
    logger.error(`Spotify credentials missing: ${missing.join(', ')}`);
    process.exitCode = 1;
    return false;
  }
  try {
    const switches = _.get(options, 'switches', {});
    if (switches.login) {
      return await runLogin({ credentials, file, fetchImpl, open });
    }
    if (switches.match) {
      return await runMatch({
        credentials,
        file,
        fetchImpl,
        config,
        dryRun: Boolean(switches.dryRun)
      });
    }
    if (switches.review) {
      return runReview({ config });
    }
    const status = await showStatus({ credentials, file, fetchImpl, env });
    if (!status.loggedIn) {
      return status;
    }
    const { plan } = await runPlan({ client: status.client, config });
    return { ..._.omit(status, 'client'), plan };
  } catch (err) {
    logger.error(err.message);
    process.exitCode = 1;
    return false;
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = { name: 'sync', func: syncCommand, defaultTarget, targetArgs: false };
