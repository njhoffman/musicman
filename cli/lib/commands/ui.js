const _ = require('lodash');

const { getFilteredFiles, reportErrors } = require('./common.js');
const { openLibrary } = require('../db/index.js');
const { spotifyPlayer } = require('../player/players.js');
const { createClient } = require('../spotify/api.js');
const { appTokenGetter } = require('../spotify/auth.js');
const { getCredentials, missingCredentials } = require('../spotify/credentials.js');
const { syncPlan } = require('../sync/plan.js');
const { songTargets } = require('../sync/targets.js');
const { reviewActions } = require('../ui/actions.js');
const { createHandler, startServer } = require('../ui/server.js');
const logger = require('../utils/logger.js');

const defaultPort = 6660;

// resolves on the first of signals, for a server that runs until ctrl-c
const untilSignal = (signals = ['SIGINT', 'SIGTERM']) =>
  new Promise(resolve => {
    const done = signal => {
      signals.forEach(name => process.removeListener(name, done));
      resolve(signal);
    };
    signals.forEach(name => process.once(name, done));
  });

/**
 * ui: serves the management page on 127.0.0.1 (ui.port) until ctrl-c: the Spotify matches waiting for
 * review, accepted, and rejected, with both versions to play and compare and accept or reject, and what
 * the last sync found to transfer between Spotify and the library. Accepting fetches Spotify fields
 * with the app credentials; without them the id alone is written.
 */
const uiCommand = async ({
  config,
  env = process.env,
  fetchImpl = fetch,
  player = spotifyPlayer(),
  until = untilSignal
}) => {
  const credentials = getCredentials(config, env);
  const missing = _.without(
    missingCredentials(credentials),
    'SPOTIFY_REDIRECT_URI (or spotify.redirectUri)'
  );
  let client = null;
  const getClient = () => {
    if (missing.length > 0) {
      return null;
    }
    client =
      client ||
      createClient({
        getToken: appTokenGetter(credentials, { fetchImpl }),
        fetchImpl,
        requestsPerSecond: _.get(config, 'spotify.requestsPerSecond')
      });
    return client;
  };
  if (missing.length > 0) {
    logger.warn(
      `Spotify credentials missing (${missing.join(', ')}): accepting writes the track id without fields`
    );
  }

  const db = openLibrary(config);
  const handler = createHandler({
    db,
    config,
    actions: reviewActions({ db, config, getClient }),
    getClient,
    librarySongs: async () =>
      songTargets(
        await getFilteredFiles({
          target: config.mpd.baseDirectory,
          options: { switches: { recursive: true } },
          config
        }),
        config
      ),
    plan: songs => syncPlan(db, config, songs),
    player
  });
  const port = _.get(config, 'ui.port', defaultPort);
  let server;
  try {
    server = await startServer(handler, { port });
  } catch (err) {
    db.close();
    throw new Error(err.code === 'EADDRINUSE' ? `Port ${port} is in use (ui.port)` : err.message, {
      cause: err
    });
  }
  logger.info(`musicman ui at http://127.0.0.1:${port}/ (ctrl-c stops it)`);
  await until();
  // close waits for open connections, and a browser keeps its connections open
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
  db.close();
  return { port };
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'ui',
  description:
    'Serve the management page: Spotify review (play and compare both versions) and transfer lists',
  usage: 'musicman ui (open http://127.0.0.1:<ui.port>/)',
  switches: [],
  completes: [],
  func: reportErrors(uiCommand),
  run: uiCommand,
  defaultTarget,
  targetArgs: false
};
