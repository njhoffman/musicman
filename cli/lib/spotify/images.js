const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Promise = require('bluebird');

// artist photos default to $XDG_CACHE_HOME/musicman/artists, one <artist id>.jpg each
const artistImageDirectory = (config, env = process.env) =>
  _.get(config, 'spotify.artistImageDirectory') ||
  path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'musicman', 'artists');

const artistImageFile = (directory, artistId) => path.join(directory, `${artistId}.jpg`);

/**
 * Saves the largest photo of each Web API artist object that has none in directory yet, so the photos
 * are there offline. Spotify lists images widest first. Returns { saved, failed } with the artist ids
 * and why each failed; a failed download never stops the run.
 */
const cacheArtistImages = async ({ artists, directory, fetchImpl = fetch, concurrency = 3 }) => {
  const missing = _.filter(
    _.uniqBy(_.compact(artists), 'id'),
    artist =>
      _.get(artist, 'images[0].url') && !fs.existsSync(artistImageFile(directory, artist.id))
  );
  const saved = [];
  const failed = [];
  await Promise.map(
    missing,
    async artist => {
      try {
        const response = await fetchImpl(artist.images[0].url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = Buffer.from(await response.arrayBuffer());
        fs.mkdirSync(directory, { recursive: true });
        // written whole or not at all, so a cut download is fetched again next time
        const file = artistImageFile(directory, artist.id);
        fs.writeFileSync(`${file}.part`, data);
        fs.renameSync(`${file}.part`, file);
        saved.push(artist.id);
      } catch (err) {
        failed.push({ id: artist.id, error: err.message });
      }
    },
    { concurrency }
  );
  return { saved, failed };
};

module.exports = { artistImageDirectory, artistImageFile, cacheArtistImages };
