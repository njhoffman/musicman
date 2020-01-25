const _ = require('lodash');

const filterFiles = filters => ([file, metadata]) => {
  const { rating = {}, include = {}, exclude = {} } = filters;

  let ratingMatch = false;
  if (_.isString(rating.min) || _.isString(rating.max)) {
    if (!_.isNaN(parseFloat(rating.min))) {
      ratingMatch = metadata.rating >= rating.min;
    }
    if (!_.isNaN(parseFloat(rating.max))) {
      ratingMatch = metadata.rating <= rating.max && ratingMatch;
    }
    // if rating set to blank/empty string, match if metadata has no rating
    ratingMatch = (rating.min === '' && !metadata.rating) || ratingMatch;
    ratingMatch = rating.exclude ? !ratingMatch : ratingMatch;
  } else {
    ratingMatch = true;
  }

  const includeMatch = _.keys(include).every(filterKey => {
    if (include[filterKey] === '') {
      return _.isEmpty(metadata[filterKey]);
    } else if (_.isArray(include[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',').map(_.toLower);
      return include[filterKey].every(multiVal => metaVals.indexOf(_.toLower(multiVal)) !== -1);
    }

    const filterVal = _.toLower(include[filterKey]);
    return _.toLower(metadata[filterKey]).indexOf(filterVal) !== -1;
  });

  const excludeMatch = _.keys(filters.exclude).every(filterKey => {
    if (exclude[filterKey] === '') {
      return !_.isEmpty(metadata[filterKey]);
    } else if (_.isArray(exclude[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',').map(_.toLower);
      return filters.exclude[filterKey].every(multiVal => metaVals.indexOf(_.toLower(multiVal)) === -1);
    }

    const filterVal = _.toLower(filters.exclude[filterKey]);
    return _.toLower(metadata[filterKey]).indexOf(filterVal) === -1;
  });

  return includeMatch && excludeMatch && ratingMatch;
};

module.exports = { filterFiles };
