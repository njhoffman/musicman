const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { envFileText, install, paths, stableNode } = require('../../scripts/install-daemon.js');

describe('notify daemon install', () => {
  let home;
  const env = {
    SPOTIFY_CLIENT_ID: 'id',
    SPOTIFY_CLIENT_SECRET: 'secret',
    SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:6659/callback'
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-daemon-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const withBuild = () => {
    const { daemonPath } = paths({ home, env: {} });
    fs.mkdirSync(path.dirname(daemonPath), { recursive: true });
    fs.writeFileSync(daemonPath, '');
    return daemonPath;
  };

  it('should run the installed build, not the repo, and load the credentials file', () => {
    const daemonPath = withBuild();
    const runs = [];
    install({
      home,
      env,
      nodePath: '/usr/bin/node',
      run: (...args) => runs.push(args),
      log: () => {}
    });
    const { unitPath, envFile } = paths({ home, env: {} });
    const unit = fs.readFileSync(unitPath, 'utf8');
    expect(unit).to.include(`ExecStart=/usr/bin/node ${daemonPath}`);
    expect(daemonPath).to.include(path.join('.local', 'share', 'musicman', 'current'));
    expect(unit).to.include(`EnvironmentFile=-${envFile}`);
    expect(fs.readFileSync(envFile, 'utf8')).to.equal(envFileText(env));
    expect(fs.statSync(envFile).mode & 0o777).to.equal(0o600);
    expect(runs).to.deep.equal([['systemctl', ['--user', 'daemon-reload']]]);
  });

  it('should refuse without an installed build, and leave out credentials the shell lacks', () => {
    expect(() => install({ home, env, run: () => {}, log: () => {} })).to.throw(
      /No installed build/
    );
    withBuild();
    const logs = [];
    install({
      home,
      env: { SPOTIFY_CLIENT_ID: 'id' },
      run: () => {},
      log: line => logs.push(line)
    });
    expect(fs.existsSync(paths({ home, env: {} }).envFile)).to.equal(false);
    expect(logs.join('\n')).to.include('are not all set');
    expect(envFileText({})).to.equal(null);
  });

  it('should run the node on PATH outside node_modules and the pnpm store', () => {
    const files = {
      '/repo/node_modules/.bin/node': '/repo/node_modules/.bin/node',
      '/home/u/.local/share/pnpm/store/v11/links/node/24/bin/node':
        '/home/u/.local/share/pnpm/store/v11/links/node/24/bin/node',
      '/home/u/.local/share/pnpm/bin/node': '/home/u/.local/share/pnpm/bin/node'
    };
    const fake = { exists: file => file in files, realpath: file => files[file] };
    const PATH = [
      '/repo/node_modules/.bin',
      '/home/u/.local/share/pnpm/store/v11/links/node/24/bin',
      '/home/u/.local/share/pnpm/bin',
      '/usr/bin'
    ].join(':');
    expect(stableNode({ PATH }, fake)).to.equal('/home/u/.local/share/pnpm/bin/node');
    expect(stableNode({ PATH: '/repo/node_modules/.bin' }, fake)).to.equal(null);
    expect(stableNode({}, fake)).to.equal(null);
  });

  it('should take the builds from MUSICMAN_HOME', () => {
    expect(paths({ home, env: { MUSICMAN_HOME: '/opt/mm' } }).daemonPath).to.equal(
      '/opt/mm/current/cli/lib/notify-daemon.js'
    );
  });
});
