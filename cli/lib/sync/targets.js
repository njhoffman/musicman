const _ = require('lodash');
const { parsePlaylistId } = require('musicman-common/config/validator');

const { filterFiles } = require('../metadata/filter.js');
const parseFilters = require('../parser/options/filters.js');

// Liked Songs is kept like a playlist under this id
const likedId = 'liked';

// playlist targets from sync.playlists, each with a filter function for [file, metadata]
const playlistTargets = config =>
  _.map(_.get(config, 'sync.playlists', []), ({ filter, playlist }) => ({
    id: parsePlaylistId(playlist),
    filter,
    matches: filterFiles(parseFilters(filter.split(/\s+(?=~?[\w]+:)/), config, 'sync'))
  }));

/**
 * The Spotify targets (Liked Songs and mapped playlists) each song belongs in, for [file, metadata]
 * pairs. Songs rated at least sync.likedRating belong in Liked Songs.
 */
const songTargets = (songs, config) => {
  const likedRating = _.get(config, 'sync.likedRating', 4.5);
  const playlists = playlistTargets(config);
  return _.map(songs, ([file, meta]) => {
    const targets = _.map(
      _.filter(playlists, ({ matches }) => matches([file, meta])),
      'id'
    );
    if (meta.rating && Number(meta.rating) >= likedRating) {
      targets.unshift(likedId);
    }
    return { file, meta, targets: _.uniq(targets) };
  });
};

module.exports = { likedId, playlistTargets, songTargets };
