const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const parseFilters = require('../parser/options/filters.js');
const { downloadedFiles, downloadTrackId, readManifest } = require('./download.js');
const { likedId, playlistTargets } = require('./targets.js');

// tags a track gets from a playlist's filter, e.g. grouping:IndieRock.Artists or context:Study, and the
// rating of an exact rating filter (rating:4.5-4.5)
const filterTags = (filter, config) => {
  const { include, rating } = parseFilters(filter.split(/\s+(?=~?[\w]+:)/), config, 'sync');
  const tags = _.pickBy(include, value => value !== '');
  const exact = !rating.exclude && rating.min && Number(rating.min) === Number(rating.max);
  return exact && !_.isNaN(Number(rating.min))
    ? { ...tags, rating: Number(rating.min).toFixed(1) }
    : tags;
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

// manifest.json in sync.downloadDirectory, replaced on every pull; written to a temporary file and
// renamed, so pnpm download never reads half of it
const writeManifest = (config, manifest) => {
  const file = path.join(config.sync.downloadDirectory, 'manifest.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temporary, file);
  return file;
};

/**
 * Adds tracks of the sync plan's pull lists (by track id) to the download manifest, with the targets
 * and tags sync --pull would give them, keeping the tracks already in it. Returns the track ids added,
 * and those not in any pull list (unknown).
 */
const addToManifest = (config, plan, trackIds, now = new Date()) => {
  if (!_.get(config, 'sync.downloadDirectory')) {
    throw new Error('sync.downloadDirectory is not set');
  }
  const built = _.keyBy(buildManifest(plan, config, now).tracks, 'trackId');
  const manifest = readManifest(config) || { createdAt: now.toISOString(), tracks: [] };
  const present = new Set(_.map(manifest.tracks, 'trackId'));
  const ids = _.uniq(trackIds);
  const added = _.filter(ids, id => built[id] && !present.has(id));
  if (added.length > 0) {
    manifest.tracks = _.sortBy(
      [...manifest.tracks, ..._.map(added, id => built[id])],
      ['artists', 'name']
    );
    writeManifest(config, manifest);
  }
  return { added, unknown: _.reject(ids, id => built[id]) };
};

/**
 * Where each track of the download manifest is: imported (sync --import took it), downloaded (a file
 * waits in the download directory), or queued (pnpm download fetches it). A Map by track id.
 */
const downloadStatus = config => {
  if (!_.get(config, 'sync.downloadDirectory')) {
    return new Map();
  }
  const manifest = readManifest(config);
  const downloaded = new Set(
    _.compact(_.map(downloadedFiles(config), file => downloadTrackId(file)))
  );
  return new Map(
    _.map(_.get(manifest, 'tracks', []), track => [
      track.trackId,
      track.importedAt ? 'imported' : downloaded.has(track.trackId) ? 'downloaded' : 'queued'
    ])
  );
};

module.exports = { addToManifest, buildManifest, downloadStatus, filterTags, writeManifest };
