const _ = require('lodash');

const { createClient } = require('./api.js');
const { userAccessToken } = require('./auth.js');
const { getCredentials, missingCredentials, tokenPath } = require('./credentials.js');

/**
 * A function returning the Spotify client for the logged in user (musicman sync --login), created on
 * first use so commands that may not need Spotify start without credentials.
 */
const lazyUserClient = (config, env = process.env) => {
  let client = null;
  return () => {
    if (!client) {
      const credentials = getCredentials(config, env);
      const missing = missingCredentials(credentials);
      if (missing.length > 0) {
        throw new Error(`Spotify credentials missing: ${missing.join(', ')}`);
      }
      client = createClient({
        getToken: () => userAccessToken({ credentials, file: tokenPath(env) }),
        requestsPerSecond: _.get(config, 'spotify.requestsPerSecond')
      });
    }
    return client;
  };
};

module.exports = { lazyUserClient };
