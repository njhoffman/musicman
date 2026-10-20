const fs = require('fs');
const os = require('os');
const path = require('path');
const sinon = require('sinon');
const { expect } = require('chai');

const { func: syncFunc } = require('./sync.js');
const { writeTokens } = require('../spotify/auth.js');

describe('Sync Command', () => {
  let directory;
  let file;
  const env = {
    SPOTIFY_CLIENT_ID: 'id',
    SPOTIFY_CLIENT_SECRET: 'secret',
    SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:6659/callback'
  };
  const run = (switches, extra = {}) =>
    syncFunc({ options: { switches }, config: {}, env, file, ...extra });

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-sync-'));
    file = path.join(directory, 'token.json');
  });

  afterEach(() => {
    process.exitCode = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should stop with an error when credentials are missing', async () => {
    expect(await syncFunc({ options: { switches: {} }, config: {}, env: {}, file })).to.be.false;
    expect(process.exitCode).to.equal(1);
  });

  it('should report when not logged in', async () => {
    expect(await run({})).to.deep.equal({ loggedIn: false });
  });

  it('should report the logged in user and refresh the sync plan', async () => {
    writeTokens(file, {
      access_token: 'a',
      refresh_token: 'r',
      expires_at: Date.now() + 3600 * 1000
    });
    const library = path.join(directory, 'music');
    fs.mkdirSync(library);
    const config = {
      mpd: { baseDirectory: library },
      db: {
        path: path.join(directory, 'musicman.sqlite'),
        backupDirectory: path.join(directory, 'backups')
      },
      library: { tags: [] },
      tags: [],
      sync: { likedRating: 4.5, playlists: [] }
    };
    require('../db/index.js').openLibrary(config).close();
    const bodies = {
      'https://api.spotify.com/v1/me': { id: 'user1', display_name: 'User One' },
      'https://api.spotify.com/v1/me/tracks?limit=50': { items: [], next: null }
    };
    const fetchImpl = sinon.stub().callsFake(async url => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(bodies[url])
    }));
    const result = await syncFunc({ options: { switches: {} }, config, env, file, fetchImpl });
    expect(result).to.include({ loggedIn: true, user: 'user1' });
    expect(result.plan.map(target => target.name)).to.deep.equal(['Liked Songs']);
  });

  it('should keep a successful login when the user lookup fails', async () => {
    const response = (status, body) => ({
      ok: status === 200,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body)
    });
    const fetchImpl = sinon.stub();
    fetchImpl
      .withArgs('https://accounts.spotify.com/api/token')
      .resolves(response(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
    fetchImpl
      .withArgs('https://api.spotify.com/v1/me')
      .resolves(response(503, { message: 'no healthy upstream' }));
    const net = require('net');
    const port = await new Promise(resolve => {
      const server = net.createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = server.address();
        server.close(() => resolve(free));
      });
    });
    const loginEnv = { ...env, SPOTIFY_REDIRECT_URI: `http://127.0.0.1:${port}/callback` };
    const result = await syncFunc({
      options: { switches: { login: true } },
      config: {},
      env: loginEnv,
      file,
      fetchImpl,
      open: url => {
        const state = new URL(url).searchParams.get('state');
        fetch(`http://127.0.0.1:${port}/callback?code=c&state=${state}`);
      }
    });
    expect(result).to.deep.equal({ user: null });
    expect(process.exitCode).to.not.equal(1);
    expect(fs.existsSync(file)).to.be.true;
  });
});
