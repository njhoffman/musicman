const _ = require('lodash');
const path = require('path');

const { beetsLayouts, isSingle } = require('../beets/layout.js');

/**
 * The album shown for a playing song. Singles keep a shared album tag that groups them by genre in MPD
 * ("Handpicked Indie-Rock"), so for a single (a beets path rule without $album files it) played from
 * MPD the album of its Spotify match (sp_album) is shown instead, when it has one. Everything else
 * shows the player's album. file is the song's path, meta its parsed tags (null when not in the
 * library).
 */
const shownAlbum = (config, { source, file, meta, album }) => {
  const spotifyAlbum = _.get(meta, 'sp_album');
  if (source !== 'mpd' || !file || !spotifyAlbum) {
    return album;
  }
  const baseDirectory = path.resolve(_.get(config, 'mpd.baseDirectory', '/'));
  const songPath = path.isAbsolute(file) ? path.relative(baseDirectory, file) : file;
  return isSingle(beetsLayouts(config), songPath) ? spotifyAlbum : album;
};

module.exports = { shownAlbum };
