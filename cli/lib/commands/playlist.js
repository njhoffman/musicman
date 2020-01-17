const _ = require('lodash');
const path = require('path');
const fs = require('fs');

const logger = require('../utils/logger');

const parseOptions = (options, config) => {
  const optionFields = {
    recursive: config.recursive
  };

  options.forEach((option, i) => {
    if (option === '-r') {
      optionFields.recursive = true;
    } else if (option === '-nr') {
      optionFields.recursive = false;
    }
  });
  return optionFields;
};

const parseRating = rating => ({
  min: rating.split('-')[0],
  max: rating.split('-')[1]
});

const parseFilters = (options, config) => {
  const filters = {
    include: {},
    exclude: {},
    rating: { min: null, max: null }
  };

  options.forEach(option => {
    const [key, val] = option.split(':');
    const filterKey = key.replace(/^\^/, '');
    const tagConfig = _.find(config.tags, { name: filterKey });
    const tagValue = `${val}`.replace(/"/g, '');
    const type = /^\^/.test(key) ? 'exclude' : 'include';

    // if argument is numeric, assume it's a rating
    if (/^\d+(?:.\d+)?$/.test(options)) {
      filters.rating = parseRating(options);
    } else if (key === 'rating') {
      filters.rating = parseRating(tagValue);
    } else if (tagConfig) {
      if (tagConfig.multi) {
        filters[type][filterKey] = tagValue.split(',');
      } else {
        // just assign whole string if not a multi field
        filters[type][filterKey] = tagValue;
      }
    }
  });
  return filters;
};

const filterFiles = filters => ([file, metadata]) => {
  const { rating, include, exclude } = filters;

  let ratingMatch = rating.min ? metadata.rating >= rating.min : true;
  if (rating.max) {
    ratingMatch = ratingMatch && metadata.rating <= rating.max;
  }

  const includeMatch = _.keys(filters.include).every(filterKey => {
    if (_.isArray(filters.include[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',');
      return filters.include[filterKey].every(multiVal => metaVals.indexOf(multiVal) !== -1);
    }
    const filterVal = filters.include[filterKey].toLowerCase();
    return metadata[filterKey].toLowerCase().indexOf(filterVal) !== -1;
  });

  const excludeMatch = _.keys(filters.exclude).every(filterKey => {
    if (_.isArray(filters.exclude[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',');
      return filters.exclude[filterKey].every(multiVal => metaVals.indexOf(multiVal) === -1);
    }
    const filterVal = filters.exclude[filterKey].toLowerCase();
    return metadata[filterKey].toLowerCase().indexOf(filterVal) === -1;
  });

  return includeMatch && excludeMatch && ratingMatch;
};

const writePlaylist = (files, outPath) => fs.writeFileSync(outPath, files.join('\n'));

const playlistCommand = async ({ target, options = '', config, utils }) => {
  const {
    file: { checkExists, getFiles },
    metadata: { getMetadata, parseFileMetadata }
  } = utils;

  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  } else if (!exists.isDirectory()) {
    throw new Error(`Target is not a directory: ${target}`);
  }

  const optionList = options.split(/([\w^]+:"[^"]+")|\s/).filter(Boolean);

  const { recursive } = parseOptions(optionList, config);
  const filters = parseFilters(optionList, config);

  const files = getFiles(target, { ext: 'mp3', recursive });

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);

  const filtered = _.chain(parsedMetadata)
    .filter(filterFiles(filters))
    .map(([file, meta]) => file.replace(config.mpd.baseDirectory, ''))
    .value();

  const { outputDirectory, outputPath } = config.playlist;
  const outPath = path.join(outputDirectory, outputPath);
  writePlaylist(filtered, outPath);

  logger.info(`${filtered.length} files saved to playlist ${outPath}`);

  return logger.outputMetadata({ target, metadata: filtered, config });
};

module.exports = { name: 'playlist', func: playlistCommand };
