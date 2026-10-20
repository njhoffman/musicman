const fs = require('fs');
const path = require('path');

const accountsUrl = 'https://accounts.spotify.com';

// read and change playlists and Liked Songs
const scopes = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify'
];

// refresh tokens this long before they expire
const expiryMarginMs = 60 * 1000;

const basicAuth = ({ clientId, clientSecret }) =>
  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

const requestToken = async (credentials, params, { fetchImpl = fetch, now = Date.now } = {}) => {
  const res = await fetchImpl(`${accountsUrl}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(credentials),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params).toString()
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Spotify token request failed (${res.status}): ${
        body.error_description || body.error || 'no details'
      }`
    );
  }
  return { ...body, expires_at: now() + body.expires_in * 1000 };
};

const authorizeUrl = (credentials, state) =>
  `${accountsUrl}/authorize?${new URLSearchParams({
    client_id: credentials.clientId,
    response_type: 'code',
    redirect_uri: credentials.redirectUri,
    scope: scopes.join(' '),
    state
  })}`;

const exchangeCode = (credentials, code, options) =>
  requestToken(
    credentials,
    { grant_type: 'authorization_code', code, redirect_uri: credentials.redirectUri },
    options
  );

// app token for requests that need no user (track lookup and search)
const appToken = async (credentials, options) =>
  (await requestToken(credentials, { grant_type: 'client_credentials' }, options)).access_token;

// app token getter that reuses the token until it is about to expire
const appTokenGetter = (credentials, { fetchImpl, now = Date.now } = {}) => {
  let cached = null;
  return async () => {
    if (!cached || cached.expires_at - expiryMarginMs <= now()) {
      cached = await requestToken(
        credentials,
        { grant_type: 'client_credentials' },
        { fetchImpl, now }
      );
    }
    return cached.access_token;
  };
};

const readTokens = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

const writeTokens = (file, tokens) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

/**
 * Access token for the logged in user, refreshed and saved when it is about to expire.
 */
const userAccessToken = async ({ credentials, file, fetchImpl, now = Date.now }) => {
  const tokens = readTokens(file);
  if (!tokens || !tokens.refresh_token) {
    throw new Error('Not logged in to Spotify, run: musicman sync --login');
  }
  if (tokens.expires_at - expiryMarginMs > now()) {
    return tokens.access_token;
  }
  const refreshed = await requestToken(
    credentials,
    { grant_type: 'refresh_token', refresh_token: tokens.refresh_token },
    { fetchImpl, now }
  );
  // Spotify only sometimes rotates the refresh token
  const updated = {
    ...tokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token || tokens.refresh_token
  };
  writeTokens(file, updated);
  return updated.access_token;
};

module.exports = {
  appToken,
  appTokenGetter,
  authorizeUrl,
  exchangeCode,
  readTokens,
  scopes,
  userAccessToken,
  writeTokens
};
