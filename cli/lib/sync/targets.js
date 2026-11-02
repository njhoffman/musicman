const _ = require('lodash');
const { parsePlaylistId } = require('musicman-common/config/validator');

const { filterFiles } = require('../metadata/filter.js');
const parseFilters = require('../parser/options/filters.js');

// Liked Songs is kept like a playlist under this id
const likedId = 'liked';

// filter function for [file, metadata] from view/search filter syntax, e.g. grouping:IndieRock.Artists
const filterMatcher = (filter, config) =>
  filterFiles(parseFilters(filter.split(/\s+(?=~?[\w]+:)/), config, 'sync'));

// playlist targets from sync.playlists, each with a filter function for [file, metadata]
const playlistTargets = config =>
  _.map(_.get(config, 'sync.playlists', []), ({ filter, playlist }) => ({
    id: parsePlaylistId(playlist),
    filter,
    matches: filterMatcher(filter, config)
  }));

// id of sync.ignorePlaylist, null without one
const ignorePlaylistId = config => {
  const playlist = _.get(config, 'sync.ignorePlaylist');
  return playlist ? parsePlaylistId(playlist) : null;
};

// track ids in the cached sync.ignorePlaylist, which sync never pulls or matches
const ignoredTracks = (db, config) => {
  const id = ignorePlaylistId(config);
  if (!id) {
    return new Set();
  }
  const rows = db
    .prepare(
      'SELECT track_id FROM spotify_playlist_tracks WHERE playlist_id = ? AND track_id IS NOT NULL'
    )
    .all(id);
  return new Set(_.map(rows, 'track_id'));
};

// whether a song takes part in sync at all: songs matching sync.scope, every song without one
const scopeMatcher = config => {
  const scope = `${_.get(config, 'sync.scope') || ''}`.trim();
  return scope ? filterMatcher(scope, config) : () => true;
};

/**
 * The Spotify targets (Liked Songs and mapped playlists) each song belongs in, for [file, metadata]
 * pairs. Songs rated at least sync.likedRating belong in Liked Songs. Songs outside sync.scope belong
 * nowhere and are marked outOfScope, so sync leaves them alone in both directions.
 */
const songTargets = (songs, config) => {
  const likedRating = _.get(config, 'sync.likedRating', 4.5);
  const playlists = playlistTargets(config);
  const inScope = scopeMatcher(config);
  return _.map(songs, ([file, meta]) => {
    if (!inScope([file, meta])) {
      return { file, meta, targets: [], outOfScope: true };
    }
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

/**
 * Groups of mapped Spotify playlists a song belongs in at most one of: playlists whose sync.playlists
 * filter is one field:value term on a field holding one value (grouping, rating; not multi value fields
 * like context), grouped by that field. A playlist several filters map to (grouping:X.Artists and
 * grouping:X.Singles) is one member. Groups with a single playlist are left out.
 */
const exclusiveGroups = config => {
  const multi = new Set(_.map(_.filter(_.get(config, 'library.tags'), 'multi'), 'name'));
  const single = _.compact(
    _.map(playlistTargets(config), target => {
      const match = /^([\w-]+):(\S+)$/.exec(`${target.filter}`.trim());
      return match && !multi.has(match[1]) ? { ...target, field: match[1] } : null;
    })
  );
  return _.compact(
    _.map(_.groupBy(single, 'field'), (targets, field) =>
      _.uniq(_.map(targets, 'id')).length > 1 ? { field, targets } : null
    )
  );
};

/**
 * The playlists of exclusive groups (exclusiveGroups) the copies of one song disagree on: given the
 * targets of each copy linked to one Spotify track, the ids of every group playlist some copy belongs
 * in, for each group where the copies call for more than one. Push adds the track to none of them
 * until the copies agree. Empty when they agree or there is one copy.
 */
const conflictingTargets = (groups, targetsPerCopy) =>
  new Set(
    _.flatMap(groups, ({ targets }) => {
      const ids = new Set(_.map(targets, 'id'));
      const wanted = _.uniq(_.flatMap(targetsPerCopy, copy => _.filter(copy, id => ids.has(id))));
      return wanted.length > 1 ? wanted : [];
    })
  );

module.exports = {
  conflictingTargets,
  exclusiveGroups,
  filterMatcher,
  ignorePlaylistId,
  ignoredTracks,
  likedId,
  playlistTargets,
  scopeMatcher,
  songTargets
};
