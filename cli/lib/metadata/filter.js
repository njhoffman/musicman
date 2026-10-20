const _ = require('lodash');

const filterRating = (rating, { min, max, exclude }) => {
  let ratingMatch = false;
  if (_.isString(min) || _.isString(max)) {
    if (!_.isNaN(parseFloat(min))) {
      ratingMatch = rating >= min;
    }
    if (!_.isNaN(parseFloat(max))) {
      ratingMatch = rating <= max && ratingMatch;
    }
    // if rating set to blank/empty string, match if metadata has no rating
    ratingMatch = (min === '' && !rating) || ratingMatch;
    ratingMatch = exclude ? !ratingMatch : ratingMatch;
  } else {
    ratingMatch = true;
  }
  return ratingMatch;
};

// TODO: can probably combine these?
const filterInclude = (include, metadata) =>
  // returns true if any matches found
  _.keys(include).every(filterKey => {
    if (include[filterKey] === '') {
      return _.isEmpty(metadata[filterKey]);
    } else if (_.isArray(include[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',').map(_.toLower);
      return include[filterKey].every(multiVal => metaVals.includes(_.toLower(multiVal)));
    }

    const filterVal = _.toLower(include[filterKey]);
    return _.toLower(metadata[filterKey]).includes(filterVal);
  });

const filterExclude = (exclude, metadata) =>
  // returns true if no matches found
  _.keys(exclude).every(filterKey => {
    if (exclude[filterKey] === '') {
      return !_.isEmpty(metadata[filterKey]);
    } else if (_.isArray(exclude[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',').map(_.toLower);
      return exclude[filterKey].every(multiVal => !metaVals.includes(_.toLower(multiVal)));
    }

    const filterVal = _.toLower(exclude[filterKey]);
    return !_.toLower(metadata[filterKey]).includes(filterVal);
  });

const filterFiles =
  filters =>
  ([file, metadata]) => {
    const { include = {}, exclude = {} } = filters;

    const ratingMatch = filterRating(metadata.rating, filters.rating || {});
    const includeMatch = filterInclude(include, metadata);
    const excludeMatch = filterExclude(exclude, metadata);

    return includeMatch && excludeMatch && ratingMatch;
  };

module.exports = { filterFiles };
