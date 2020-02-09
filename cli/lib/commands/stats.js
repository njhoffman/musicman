const _ = require('lodash');

const { getFilteredFiles } = require('./common');
const logger = require('../utils/logger');
const { outputMetadata } = require('../output');

const calculateMultifield = (multiField, allFiles) => {
  const multiVals = {};
  const files = _.map(allFiles, ([filePath, file]) => (_.has(file, multiField) ? file : null)).filter(Boolean);
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

const statsCommand = async ({ options, config }) => {
  const target = config.mpd.baseDirectory;
  const { filters, multiFields } = config.stats;

  const allFiles = await getFilteredFiles({ target, options, config });

  const multifieldOutput = multiFields.map(mf => calculateMultifield(mf, allFiles));

  console.log('ALL FILES', multifieldOutput);

  // return outputMetadata({ target, metadata: _.unzip(filtered)[1], config, options });
};

module.exports = { name: 'stats', func: statsCommand };
