const _ = require('lodash');
const chalk = require('chalk');
const { inspect } = require('util');

const { consoleLog } = require('../utils/logger.cjs');
const { outputTable } = require('./table.cjs');
const { outputVertical } = require('./vertical.cjs');
const { outputDifferences } = require('./differences.cjs');
const { outputStats } = require('./stats.cjs');

const inspectOptions = { compact: true, colors: true };

const outputNotFound = (filters, target) => {
  let output = `\nNo mp3 files found in \n\t${chalk.hex('#888899')(target)} `;
  const { include, exclude } = filters;
  if (_.keys(filters).length > 0) {
    let filterStr = !_.isEmpty(include) ? `\n\t${inspect({ include }, inspectOptions)}` : '';
    filterStr += !_.isEmpty(exclude) ? `\n\t${inspect(exclude)}` : '';
    const { min, max } = _.get(filters, 'rating');
    filterStr += !_.isNull(min) || !_.isNull(max) ? `\n\t${inspect({ rating: filters.rating }, inspectOptions)}` : '';
    output += filterStr ? `\n  that match filters: ${filterStr}` : '(no filters)';
  }
  return output;
};

const outputMetadata = ({ metadata, target, options, config, format }) => {
  const { filters } = options;

  let output;
  if (metadata && metadata.length === 0) {
    output = outputNotFound(filters, target);
  } else if (format === 'vertical') {
    output = outputVertical(metadata, config);
  } else {
    output = outputTable(metadata, config);
  }
  return consoleLog(output);
};

module.exports = { outputDifferences, outputMetadata, outputStats };
