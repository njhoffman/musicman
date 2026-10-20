const _ = require('lodash');
const chalk = require('chalk').default;
const { inspect } = require('util');

const { consoleLog } = require('../utils/logger.js');
const { outputTable } = require('./table.js');
const { outputList } = require('./list.js');
const { outputDifferences } = require('./differences.js');
const { outputStats } = require('./stats.js');

const inspectOptions = { compact: true, colors: true };

const outputNotFound = (filters, target) => {
  let output = `\nNo mp3 files found in \n\t${chalk.hex('#888899')(target)} `;
  const { include, exclude } = filters;
  if (_.keys(filters).length > 0) {
    let filterStr = !_.isEmpty(include) ? `\n\t${inspect({ include }, inspectOptions)}` : '';
    filterStr += !_.isEmpty(exclude) ? `\n\t${inspect(exclude)}` : '';
    const { min, max } = _.get(filters, 'rating');
    filterStr +=
      !_.isNull(min) || !_.isNull(max)
        ? `\n\t${inspect({ rating: filters.rating }, inspectOptions)}`
        : '';
    output += filterStr ? `\n  that match filters: ${filterStr}` : '(no filters)';
  }
  return output;
};

const outputMetadata = ({ metadata, target, options, config, format }) => {
  const { filters } = options;

  let output;
  if (metadata && metadata.length === 0) {
    output = outputNotFound(filters, target);
  } else if (format === 'list') {
    output = outputList(metadata, config);
  } else {
    output = outputTable(metadata, config);
  }
  return consoleLog(output);
};

module.exports = { outputDifferences, outputMetadata, outputStats };
