const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { pathsFile, publishPaths } = require('./paths.js');

describe('paths.json', () => {
  let dir;
  let file;
  const config = {
    mpd: { host: 'localhost', port: '6600', baseDirectory: '/music/Sorted/' },
    db: { path: '/music/Sorted/musicman.sqlite' }
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-paths-'));
    file = path.join(dir, 'state', 'musicman', 'paths.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should live in $XDG_STATE_HOME/musicman, ~/.local/state without it', () => {
    expect(pathsFile({ XDG_STATE_HOME: '/state' })).to.equal('/state/musicman/paths.json');
    expect(pathsFile({})).to.equal(path.join(os.homedir(), '.local/state/musicman/paths.json'));
  });

  it('should write MPD and the database with resolved paths, creating the directory', () => {
    expect(publishPaths(config, { file })).to.equal(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({
      version: 1,
      mpd: { host: 'localhost', port: 6600, baseDirectory: '/music/Sorted' },
      db: { path: '/music/Sorted/musicman.sqlite' }
    });
    expect(fs.readdirSync(path.dirname(file))).to.deep.equal(['paths.json']);
  });

  it('should only write when the contents change', () => {
    publishPaths(config, { file });
    const { mtimeMs } = fs.statSync(file);
    expect(publishPaths(config, { file })).to.equal(false);
    expect(fs.statSync(file).mtimeMs).to.equal(mtimeMs);
    expect(publishPaths({ ...config, mpd: { ...config.mpd, port: 6601 } }, { file })).to.equal(
      true
    );
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).mpd.port).to.equal(6601);
  });
});
