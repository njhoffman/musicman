const _ = require('lodash');
const os = require('os');
const path = require('path');

/**
 * Spotify app credentials, from SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI
 * (or SPOTIFY_REDIRECT_URL) in the environment, falling back to spotify.* in the config.
 */
const getCredentials = (config, env = process.env) => ({
  clientId: env.SPOTIFY_CLIENT_ID || _.get(config, 'spotify.clientId') || null,
  clientSecret: env.SPOTIFY_CLIENT_SECRET || _.get(config, 'spotify.clientSecret') || null,
  redirectUri:
    env.SPOTIFY_REDIRECT_URI ||
    env.SPOTIFY_REDIRECT_URL ||
    _.get(config, 'spotify.redirectUri') ||
    null
});

// names of credentials that are missing, for error messages
const missingCredentials = credentials =>
  _.compact([
    !credentials.clientId && 'SPOTIFY_CLIENT_ID (or spotify.clientId)',
    !credentials.clientSecret && 'SPOTIFY_CLIENT_SECRET (or spotify.clientSecret)',
    !credentials.redirectUri && 'SPOTIFY_REDIRECT_URI (or spotify.redirectUri)'
  ]);

// login tokens live outside the config file, readable only by the user
const tokenPath = (env = process.env) =>
  path.join(
    env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'musicman',
    'spotify-token.json'
  );

module.exports = { getCredentials, missingCredentials, tokenPath };
