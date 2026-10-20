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

  it('should report the logged in user', async () => {
    writeTokens(file, {
      access_token: 'a',
      refresh_token: 'r',
      expires_at: Date.now() + 3600 * 1000
    });
    const fetchImpl = sinon.stub().resolves({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ id: 'user1', display_name: 'User One' })
    });
    expect(await run({}, { fetchImpl })).to.deep.equal({ loggedIn: true, user: 'user1' });
    expect(fetchImpl.firstCall.args[0]).to.equal('https://api.spotify.com/v1/me');
  });
});
