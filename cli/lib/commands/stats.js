const _ = require('lodash');

const { getFilteredFiles } = require('./common');
const logger = require('../utils/logger');

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
        multiVals[mfValue] = _.has(multiVals, mfValue) ? (multiVals[mfValue] += 1) : 1;
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

const statsCommand = async ({ options, config, target }) => {
  const { baseDirectory } = config.mpd;
  const { multiFields } = config.stats;

  logger.info(`Scanning ${target || baseDirectory} for mp3 files`);
  const allFiles = await getFilteredFiles({ target: target || baseDirectory, options, config });

  logger.debug(`Processed ${allFiles.length} files`);
  const multifieldOutput = multiFields.map(mf => calculateMultifield(mf, allFiles));
  const ratingsOutput = allFiles.reduce(calculateRatings, { unrated: 0, rated: 0, ratings: {} });

  multifieldOutput.map(out => logger.info(out));
  logger.info(ratingsOutput);
  logger.info(`Total: \t${allFiles.length}`);

  // return outputMetadata({ target, metadata: _.unzip(filtered)[1], config, options });
};

module.exports = { name: 'stats', func: statsCommand };
