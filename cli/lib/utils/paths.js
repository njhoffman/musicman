const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * paths.json: where other programs (sleeve) find MPD, the music library, and the library database without
 * reading ~/.musicmanrc.yml. Written by the cli and the notify daemon after loading the config, only when
 * its contents change, and replaced atomically. The fields are a contract, see docs/09-contract.md: add
 * fields freely, and bump version for anything that removes or changes one.
 */
const pathsVersion = 1;

// $XDG_STATE_HOME/musicman/paths.json, ~/.local/state when XDG_STATE_HOME is not set
const pathsFile = (env = process.env) =>
  path.join(
    env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'musicman',
    'paths.json'
  );

const pathsOf = config => ({
  version: pathsVersion,
  mpd: {
    host: config.mpd.host,
    port: Number(config.mpd.port),
    baseDirectory: path.resolve(config.mpd.baseDirectory)
  },
  db: { path: config.db.path ? path.resolve(config.db.path) : null }
});

// writes paths.json for config, resolving to whether it changed
const publishPaths = (config, { file = pathsFile() } = {}) => {
  const text = `${JSON.stringify(pathsOf(config), null, 2)}\n`;
  try {
    if (fs.readFileSync(file, 'utf8') === text) {
      return false;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
  return true;
};

module.exports = { pathsFile, pathsOf, pathsVersion, publishPaths };
