const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const sinon = require('sinon');
const { expect } = require('chai');

const { createClient } = require('./api.js');
const {
  appToken,
  authorizeUrl,
  exchangeCode,
  scopes,
  userAccessToken,
  writeTokens
} = require('./auth.js');
const { getCredentials, missingCredentials, tokenPath } = require('./credentials.js');
const { login } = require('./login.js');

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => headers[name.toLowerCase()] || null },
  json: async () => body,
  text: async () => (body === undefined ? '' : JSON.stringify(body))
});

const credentials = {
  clientId: 'id',
  clientSecret: 'secret',
  redirectUri: 'http://127.0.0.1:6659/callback'
};

describe('Spotify', () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-spotify-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('credentials', () => {
    const config = {
      spotify: {
        clientId: 'config-id',
        clientSecret: 'config-secret',
        redirectUri: 'http://127.0.0.1:1/c'
      }
    };

    it('should prefer the environment over the config', () => {
      const env = {
        SPOTIFY_CLIENT_ID: 'env-id',
        SPOTIFY_CLIENT_SECRET: 'env-secret',
        SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:2/c'
      };
      expect(getCredentials(config, env)).to.deep.equal({
        clientId: 'env-id',
        clientSecret: 'env-secret',
        redirectUri: 'http://127.0.0.1:2/c'
      });
    });

    it('should fall back to the config and accept SPOTIFY_REDIRECT_URL', () => {
      expect(
        getCredentials(config, { SPOTIFY_REDIRECT_URL: 'http://127.0.0.1:3/c' })
      ).to.deep.equal({
        clientId: 'config-id',
        clientSecret: 'config-secret',
        redirectUri: 'http://127.0.0.1:3/c'
      });
    });

    it('should name missing credentials', () => {
      expect(missingCredentials(getCredentials({}, {}))).to.have.length(3);
      expect(missingCredentials(credentials)).to.be.empty;
    });

    it('should store tokens in the XDG state directory', () => {
      expect(tokenPath({ XDG_STATE_HOME: '/state' })).to.equal(
        '/state/musicman/spotify-token.json'
      );
    });
  });

  describe('auth', () => {
    it('should build the authorize url with scopes and state', () => {
      const url = new URL(authorizeUrl(credentials, 'abc'));
      expect(url.origin + url.pathname).to.equal('https://accounts.spotify.com/authorize');
      expect(Object.fromEntries(url.searchParams)).to.deep.equal({
        client_id: 'id',
        response_type: 'code',
        redirect_uri: credentials.redirectUri,
        scope: scopes.join(' '),
        state: 'abc'
      });
    });

    it('should retry a token request after network errors and explain a lasting one', async () => {
      const networkError = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNRESET' }
      });
      const sleep = sinon.stub().resolves();
      const flaky = sinon
        .stub()
        .onFirstCall()
        .rejects(networkError)
        .onSecondCall()
        .resolves(jsonResponse(200, { access_token: 'app', expires_in: 3600 }));
      expect(await appToken(credentials, { fetchImpl: flaky, sleep })).to.equal('app');
      expect(sleep).to.have.been.calledOnceWith(1000);

      const down = sinon.stub().rejects(networkError);
      const err = await appToken(credentials, { fetchImpl: down, sleep, retries: 2 }).catch(e => e);
      expect(err.message).to.equal('Spotify token request failed: fetch failed (ECONNRESET)');
      expect(down).to.have.been.calledThrice;
    });

    it('should exchange a code with basic auth and record the expiry', async () => {
      const fetchImpl = sinon
        .stub()
        .resolves(jsonResponse(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
      const tokens = await exchangeCode(credentials, 'code', { fetchImpl, now: () => 1000 });
      expect(tokens).to.include({
        access_token: 'a',
        refresh_token: 'r',
        expires_at: 1000 + 3600 * 1000
      });
      const [url, request] = fetchImpl.firstCall.args;
      expect(url).to.equal('https://accounts.spotify.com/api/token');
      expect(request.headers.Authorization).to.equal(
        `Basic ${Buffer.from('id:secret').toString('base64')}`
      );
      expect(Object.fromEntries(new URLSearchParams(request.body))).to.deep.equal({
        grant_type: 'authorization_code',
        code: 'code',
        redirect_uri: credentials.redirectUri
      });
    });

    it('should report token errors with the Spotify description', async () => {
      const fetchImpl = sinon
        .stub()
        .resolves(jsonResponse(400, { error: 'invalid_grant', error_description: 'Invalid code' }));
      try {
        await exchangeCode(credentials, 'bad', { fetchImpl });
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.equal('Spotify token request failed (400): Invalid code');
      }
    });

    it('should require a login before using the user token', async () => {
      try {
        await userAccessToken({ credentials, file: path.join(directory, 'none.json') });
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.include('sync --login');
      }
    });

    it('should use a saved token until it is about to expire', async () => {
      const file = path.join(directory, 'token.json');
      writeTokens(file, { access_token: 'saved', refresh_token: 'r', expires_at: 10 * 60 * 1000 });
      const fetchImpl = sinon.stub();
      expect(await userAccessToken({ credentials, file, fetchImpl, now: () => 0 })).to.equal(
        'saved'
      );
      expect(fetchImpl).to.not.have.been.called;
    });

    it('should refresh an expiring token, keep the refresh token, and save it privately', async () => {
      const file = path.join(directory, 'state', 'token.json');
      writeTokens(file, { access_token: 'old', refresh_token: 'r', expires_at: 30 * 1000 });
      const fetchImpl = sinon
        .stub()
        .resolves(jsonResponse(200, { access_token: 'new', expires_in: 3600 }));
      expect(await userAccessToken({ credentials, file, fetchImpl, now: () => 0 })).to.equal('new');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(saved).to.include({ access_token: 'new', refresh_token: 'r' });

      expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
    });
  });

  describe('api', () => {
    const client = fetchImpl =>
      createClient({
        getToken: async () => 'token',
        fetchImpl,
        sleep: sinon.stub().resolves(),
        retries: 2
      });

    it('should send bearer requests to the Web API', async () => {
      const fetchImpl = sinon.stub().resolves(jsonResponse(200, { id: 'me' }));
      expect(await client(fetchImpl).get('/me')).to.deep.equal({ id: 'me' });
      expect(fetchImpl.firstCall.args[0]).to.equal('https://api.spotify.com/v1/me');
      expect(fetchImpl.firstCall.args[1].headers.Authorization).to.equal('Bearer token');
    });

    it('should wait Retry-After when rate limited and retry', async () => {
      const sleep = sinon.stub().resolves();
      const fetchImpl = sinon.stub();
      fetchImpl.onFirstCall().resolves(jsonResponse(429, {}, { 'retry-after': '3' }));
      fetchImpl.onSecondCall().resolves(jsonResponse(200, { ok: true }));
      const api = createClient({ getToken: async () => 't', fetchImpl, sleep });
      expect(await api.get('/me')).to.deep.equal({ ok: true });
      expect(sleep).to.have.been.calledOnceWith(3000);
    });

    it('should retry server errors and fail with the status after the last retry', async () => {
      const fetchImpl = sinon
        .stub()
        .resolves(jsonResponse(503, { message: 'no healthy upstream' }));
      try {
        await client(fetchImpl).get('/tracks/x');
        expect.fail('Should have rejected');
      } catch (err) {
        expect(fetchImpl).to.have.been.calledThrice;
        expect(err.status).to.equal(503);
        expect(err.message).to.equal('Spotify API GET /tracks/x failed (503): no healthy upstream');
      }
    });

    it('should follow next links when paginating', async () => {
      const fetchImpl = sinon.stub();
      fetchImpl
        .onFirstCall()
        .resolves(
          jsonResponse(200, { items: [1, 2], next: 'https://api.spotify.com/v1/p?offset=2' })
        );
      fetchImpl.onSecondCall().resolves(jsonResponse(200, { items: [3], next: null }));
      expect(await client(fetchImpl).paginate('/p')).to.deep.equal([1, 2, 3]);
    });

    it('should return null for empty responses', async () => {
      const fetchImpl = sinon.stub().resolves(jsonResponse(204, undefined));
      expect(await client(fetchImpl).request('PUT', '/me/tracks', { ids: ['a'] })).to.be.null;
    });
  });

  describe('login', () => {
    const freePort = () =>
      new Promise(resolve => {
        const server = net.createServer().listen(0, '127.0.0.1', () => {
          const { port } = server.address();
          server.close(() => resolve(port));
        });
      });

    it('should exchange the callback code for tokens and save them', async () => {
      const port = await freePort();
      const file = path.join(directory, 'token.json');
      const loginCredentials = { ...credentials, redirectUri: `http://127.0.0.1:${port}/callback` };
      const fetchImpl = sinon
        .stub()
        .resolves(jsonResponse(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
      let callback;
      const done = login({
        credentials: loginCredentials,
        file,
        fetchImpl,
        open: () => {},
        onUrl: url => {
          const state = new URL(url).searchParams.get('state');
          callback = fetch(`http://127.0.0.1:${port}/callback?code=the-code&state=${state}`);
        }
      });
      const tokens = await done;
      expect((await callback).status).to.equal(200);
      expect(tokens).to.include({ access_token: 'a' });
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.include({ refresh_token: 'r' });
      expect(Object.fromEntries(new URLSearchParams(fetchImpl.firstCall.args[1].body))).to.include({
        code: 'the-code'
      });
    });

    it('should reject a callback with the wrong state', async () => {
      const port = await freePort();
      const done = login({
        credentials: { ...credentials, redirectUri: `http://127.0.0.1:${port}/callback` },
        file: path.join(directory, 'token.json'),
        open: () => {},
        onUrl: () => fetch(`http://127.0.0.1:${port}/callback?code=x&state=forged`)
      });
      try {
        await done;
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.equal('Spotify login state did not match');
      }
    });

    it('should refuse redirect URIs that are not http loopback addresses', async () => {
      try {
        await login({
          credentials: { ...credentials, redirectUri: 'https://example.com/callback' },
          onUrl: () => {}
        });
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.include('must be an http loopback address');
      }
    });
  });
});
