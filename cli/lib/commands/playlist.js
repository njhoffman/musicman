const _ = require('lodash');
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

const parseFilters = (options, config) => {
  const filters = { include: {}, exclude: {}, rating: { min: null, max: null } };

  options.forEach(option => {
    const [key, val] = option.split(':');
    const filterKey = key.replace(/^\^/, '');
    const tagConfig = _.find(config.tags, { name: filterKey });
    const tagValue = `${val}`.replace(/"/g, '');
    const type = /^\^/.test(key) ? 'exclude' : 'include';

    // if argument is numeric, assume it's a rating
    if (/^\d+(?:.\d+)?$/.test(options)) {
      filters.rating.min = option;
    } else if (key === 'rating') {
      filters.rating.min = tagValue;
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
  const include = _.keys(filters.include).every(filterKey => {
    if (_.isArray(filters.include[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',');
      return filters.include[filterKey].every(multiVal => metaVals.indexOf(multiVal) !== -1);
    } else {
      const filterVal = filters.include[filterKey].toLowerCase();
      return metadata[filterKey].toLowerCase().indexOf(filterVal) !== -1;
    }
  });

  const exclude = _.keys(filters.exclude).every(filterKey => {
    if (_.isArray(filters.exclude[filterKey])) {
      const metaVals = `${metadata[filterKey]}`.split(',');
      return filters.exclude[filterKey].every(multiVal => metaVals.indexOf(multiVal) === -1);
    } else {
      const filterVal = filters.exclude[filterKey].toLowerCase();
      return metadata[filterKey].toLowerCase().indexOf(filterVal) === -1;
    }
  });

  return include && exclude;
};

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
    .map(([file, meta]) => meta)
    .value();

  return logger.outputMetadata({ target, metadata: filtered, config });
};

module.exports = { name: 'playlist', func: playlistCommand };
