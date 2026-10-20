const _ = require('lodash');

const { getFilteredFiles } = require('./common.js');
const { countTags } = require('../metadata/tags.js');
const { outputStats } = require('../output/index.js');
const logger = require('../utils/logger.js');

const calculateMultifield = (multiField, allFiles) => {
  const multiVals = {};
  const files = _.map(allFiles, ([filePath, file]) =>
    _.has(file, multiField) ? file : null
  ).filter(Boolean);
  files.forEach(file => {
    `${file[multiField]}`
      .split(',')
      .filter(Boolean)
      .forEach(mfValue => {
        const val = mfValue.trim();
        multiVals[val] = _.has(multiVals, val) ? (multiVals[val] += 1) : 1;
      });
  });
  return { [multiField]: multiVals };
};

const calculateRatings = (totals, [, file]) => {
  if (!_.isEmpty(file.rating)) {
    return _.merge(totals, {
      rated: totals.rated + 1,
      ratings: {
        ...totals.ratings,
        [file.rating]: _.has(totals.ratings, file.rating) ? totals.ratings[file.rating] + 1 : 1
      }
    });
  }
  return _.merge(totals, {
    unrated: totals.unrated + 1
  });
};

const calculateSizes = (totals, [, file]) => {
  return _.merge(totals, {
    size: file.size ? totals.size + Math.floor(file.size / 1024) : totals.size,
    duration: file.duration ? totals.duration + Math.floor(file.duration) : totals.duration
  });
};

const statsCommand = async ({ options, config, target }) => {
  const { baseDirectory } = config.mpd;
  const { multiFields } = config.stats;

  logger.info(`Scanning ${target || baseDirectory} for mp3 files`);
  // TODO: add option to include duration and size
  const allFiles = await getFilteredFiles({
    target: target || baseDirectory,
    options,
    config,
    fullMetadata: true,
    withRaw: true
  });

  logger.debug(`Processed ${allFiles.length} files`);

  // value counts keyed by field name, genre and grouping are always included
  const fields = _.assign(
    {},
    ..._.uniq(['genre', 'grouping'].concat(multiFields)).map(mf =>
      calculateMultifield(mf, allFiles)
    )
  );

  const ratingsOutput = allFiles.reduce(calculateRatings, { unrated: 0, rated: 0, ratings: {} });

  const sizesOutput = allFiles.reduce(calculateSizes, { size: 0, duration: 0 });

  // number of files with each populated id3 frame, including custom TXXX fields
  const tags = countTags(_.map(allFiles, 2), config);

  const stats = { fields, tags, total: allFiles.length, ...ratingsOutput, ...sizesOutput };

  return outputStats({ target, stats, config, options });
};

module.exports = {
  name: 'stats',
  description: 'Count values, ratings, and populated tags across files',
  usage: 'musicman stats [target] [field:value ...]',
  switches: ['recursive', 'norecursive', 'files'],
  func: statsCommand
};
