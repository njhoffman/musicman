const _ = require('lodash');

const parseFilters = require('../parser/options/filters.js');
const { likedId, playlistTargets } = require('./targets.js');

/**
 * The tag a playlist filter can be inverted to: { field, value } when the filter is one value of a multi
 * value field (context:Study), so adding or removing that value adds or removes the song. Other filters
 * (grouping:IndieRock.Artists, several conditions, exclusions, ratings) are null.
 */
const filterTag = (filter, config) => {
  const { include, exclude, rating } = parseFilters(
    filter.split(/\s+(?=~?[\w]+:)/),
    config,
    'sync'
  );
  const fields = _.keys(include);
  const value = include[fields[0]];
  const ratingSet = _.isString(rating.min) || _.isString(rating.max);
  if (fields.length !== 1 || !_.isEmpty(exclude) || ratingSet || !_.isArray(value)) {
    return null;
  }
  return value.length === 1 && value[0] ? { field: fields[0], value: value[0] } : null;
};

/**
 * Local tag changes for the changes made on Spotify in a plan (spotifyAdded, spotifyRemoved): per file,
 * the assignments that add or remove a playlist's filter value ({ context: ['+Study', '-Run'] }), and the
 * changes that need a decision (Liked Songs, single value filters like grouping, several conditions).
 */
const membershipChanges = (plan, config) => {
  const filters = _.fromPairs(_.map(playlistTargets(config), ({ id, filter }) => [id, filter]));
  const assignments = {};
  const decide = [];
  _.each(plan, target => {
    const tag =
      target.id === likedId || !filters[target.id] ? null : filterTag(filters[target.id], config);
    const changes = [
      ..._.map(target.spotifyAdded, ({ file, name, artists }) => ({
        file,
        sign: '+',
        label: `${artists} - ${name}`
      })),
      ..._.map(target.spotifyRemoved, ({ file }) => ({ file, sign: '-' }))
    ];
    _.each(changes, ({ file, sign, label }) => {
      const change = sign === '+' ? 'added' : 'removed';
      if (!tag) {
        decide.push({
          file,
          label,
          target: target.name,
          targetId: target.id,
          change,
          filter: filters[target.id]
        });
        return;
      }
      const fileAssignments = assignments[file] || {};
      fileAssignments[tag.field] = [...(fileAssignments[tag.field] || []), `${sign}${tag.value}`];
      assignments[file] = fileAssignments;
    });
  });
  return { assignments, decide };
};

module.exports = { filterTag, membershipChanges };
