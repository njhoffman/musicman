const _ = require('lodash');

// ratings compare as numbers, so 4.0 is within rating:3.5-4 and rating:4-4
const filterRating = (rating, { min, max, exclude }) => {
  let ratingMatch = false;
  if (_.isString(min) || _.isString(max)) {
    if (!_.isNaN(parseFloat(min))) {
      ratingMatch = Number(rating) >= Number(min);
    }
    if (!_.isNaN(parseFloat(max))) {
      ratingMatch = Number(rating) <= Number(max) && ratingMatch;
    }
    // if rating set to blank/empty string, match if metadata has no rating
    ratingMatch = (min === '' && !rating) || ratingMatch;
    ratingMatch = exclude ? !ratingMatch : ratingMatch;
  } else {
    ratingMatch = true;
  }
  return ratingMatch;
};

/**
 * Whether a song's value of one field matches a filter value: an empty filter matches an empty field,
 * a list (multi value fields) matches when every item is one of the field's values, and text matches
 * as a case-insensitive substring. Each item of a list is tested on its own, so exclude (negate) means
 * none of them is present, not that some is missing.
 */
const fieldMatches = (filterValue, metaValue, negate) => {
  const test = matched => (negate ? !matched : matched);
  if (filterValue === '') {
    return test(_.isEmpty(metaValue));
  }
  if (_.isArray(filterValue)) {
    const metaVals = `${metaValue}`.split(',').map(_.toLower);
    return filterValue.every(item => test(metaVals.includes(_.toLower(item))));
  }
  return test(_.toLower(metaValue).includes(_.toLower(filterValue)));
};

// true when every field of the filters matches the song (include), or none does (exclude, negate)
const matchesFilters = (filters, metadata, { negate = false } = {}) =>
  _.keys(filters).every(key => fieldMatches(filters[key], metadata[key], negate));

const filterFiles =
  filters =>
  ([file, metadata]) => {
    const { include = {}, exclude = {} } = filters;

    const ratingMatch = filterRating(metadata.rating, filters.rating || {});
    const includeMatch = matchesFilters(include, metadata);
    const excludeMatch = matchesFilters(exclude, metadata, { negate: true });

    return includeMatch && excludeMatch && ratingMatch;
  };

module.exports = { filterFiles };
