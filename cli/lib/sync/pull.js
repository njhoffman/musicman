const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const parseFilters = require('../parser/options/filters.js');
const { likedId, playlistTargets } = require('./targets.js');

// tags a track gets from a playlist's filter, e.g. grouping:IndieRock.Artists or context:Study
const filterTags = (filter, config) => {
  const { include } = parseFilters(filter.split(/\s+(?=~?[\w]+:)/), config, 'sync');
  return _.pickBy(include, value => value !== '');
};

// combine tags from several playlists, multi value fields collect every value
const mergeTags = (tags, more) =>
  _.mergeWith({ ...tags }, more, (existing, value) =>
    _.isArray(existing) || _.isArray(value) ? _.uniq([].concat(existing || [], value)) : undefined
  );

/**
 * Download manifest for tracks in Spotify targets that are not in the library (syncPlan pull lists),
 * one entry per track with its URL, the targets it is in, and the tags those targets imply.
 */
const buildManifest = (plan, config, now = new Date()) => {
  const filters = _.fromPairs(_.map(playlistTargets(config), ({ id, filter }) => [id, filter]));
  const tracks = new Map();
  _.each(plan, target => {
    _.each(target.pull, track => {
      const entry = tracks.get(track.track_id) || {
        trackId: track.track_id,
        url: `https://open.spotify.com/track/${track.track_id}`,
        name: track.name,
        artists: track.artists,
        album: track.album,
        targets: [],
        tags: {}
      };
      entry.targets.push(target.name);
      if (target.id !== likedId && filters[target.id]) {
        entry.tags = mergeTags(entry.tags, filterTags(filters[target.id], config));
      }
      tracks.set(track.track_id, entry);
    });
  });
  return {
    createdAt: now.toISOString(),
    tracks: _.sortBy([...tracks.values()], ['artists', 'name'])
  };
};

// manifest.json in sync.downloadDirectory, replaced on every pull
const writeManifest = (config, manifest) => {
  const file = path.join(config.sync.downloadDirectory, 'manifest.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
};

module.exports = { buildManifest, filterTags, writeManifest };
