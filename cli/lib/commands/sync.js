const _ = require('lodash');

const { createClient } = require('../spotify/api.js');
const { readTokens, userAccessToken } = require('../spotify/auth.js');
const { getCredentials, missingCredentials, tokenPath } = require('../spotify/credentials.js');
const { login } = require('../spotify/login.js');
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
  const me = await userClient({ credentials, file, fetchImpl }).get('/me');
  logger.info(`Logged in as ${me.display_name || me.id}`);
  logger.info('Playlist sync (pull, push, Liked Songs) is not implemented yet');
  return { loggedIn: true, user: me.id };
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
    if (_.get(options, 'switches.login')) {
      return await runLogin({ credentials, file, fetchImpl, open });
    }
    return await showStatus({ credentials, file, fetchImpl, env });
  } catch (err) {
    logger.error(err.message);
    process.exitCode = 1;
    return false;
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = { name: 'sync', func: syncCommand, defaultTarget, targetArgs: false };
