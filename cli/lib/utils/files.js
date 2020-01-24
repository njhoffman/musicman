const _ = require('lodash');
const glob = require('glob');
const { statSync } = require('fs');

const checkExists = target => {
  try {
    const stat = statSync(target);
    return stat;
  } catch {
    return false;
  }
};

const getFiles = (dir, options = { ext: 'mp3', recursive: false }) => {
  const { recursive, ext } = options;
  const globPath = recursive ? `${dir}/**/*.${ext}` : `${dir}/*.${ext}`;
  const files = glob.sync(globPath);
  return files;
};

const filterFiles = filters => ([file, metadata]) => {
  const { rating = {}, include = {}, exclude = {} } = filters;

  let ratingMatch = rating.min ? metadata.rating >= rating.min : true;
  if (rating.max) {
    ratingMatch = ratingMatch && metadata.rating <= rating.max;
  }
  ratingMatch = rating.exclude ? !ratingMatch : ratingMatch;

  const includeMatch = _.keys(filters.include).every(filterKey => {
    if (_.isArray(include[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',');
      return filters.include[filterKey].every(multiVal => metaVals.indexOf(multiVal) !== -1);
    }
    const filterVal = filters.include[filterKey].toLowerCase();
    return metadata[filterKey].toLowerCase().indexOf(filterVal) !== -1;
  });

  const excludeMatch = _.keys(filters.exclude).every(filterKey => {
    if (_.isArray(exclude[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',');
      return filters.exclude[filterKey].every(multiVal => metaVals.indexOf(multiVal) === -1);
    }
    const filterVal = filters.exclude[filterKey].toLowerCase();
    return metadata[filterKey].toLowerCase().indexOf(filterVal) === -1;
  });

  return includeMatch && excludeMatch && ratingMatch;
};

module.exports = {
  checkExists,
  getFiles,
  filterFiles
};
