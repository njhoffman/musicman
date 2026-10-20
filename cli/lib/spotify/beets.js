const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { DatabaseSync } = require('node:sqlite');

const expandHome = file =>
  file && file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;

// beets library database and music directory from the beets config, null when there is no config
const readBeetsConfig = configPath => {
  if (!configPath || !fs.existsSync(configPath)) {
    return null;
  }
  const beets = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
  return {
    library: expandHome(beets.library || path.join(path.dirname(configPath), 'library.db')),
    directory: expandHome(beets.directory || '~/Music')
  };
};

/**
 * Spotify track ids beets stored for items (spotify plugin attributes), keyed by absolute file path.
 * Opens the beets library read-only.
 */
const readBeetsSpotifyIds = configPath => {
  const beets = readBeetsConfig(configPath);
  if (!beets || !fs.existsSync(beets.library)) {
    return new Map();
  }
  const db = new DatabaseSync(beets.library, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT i.path, a.value FROM items i
         JOIN item_attributes a ON a.entity_id = i.id AND a.key = 'spotify_track_id'`
      )
      .all();
    return new Map(
      _.map(rows, ({ path: itemPath, value }) => {
        const file = Buffer.from(itemPath).toString();
        return [path.isAbsolute(file) ? file : path.join(beets.directory, file), value];
      })
    );
  } finally {
    db.close();
  }
};

module.exports = { readBeetsConfig, readBeetsSpotifyIds };
