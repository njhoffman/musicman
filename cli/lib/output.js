const _ = require('lodash');
const chalk = require('chalk');
const diff = require('diff');
const columnify = require('columnify');
const { inspect } = require('util');

const { consoleLog } = require('./utils/logger');
const { outputTable } = require('./output/table');
const { outputVertical } = require('./output/vertical');

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
  if (metadata.length === 0) {
    output = outputNotFound(filters, target);
  } else if (format === 'vertical') {
    output = outputVertical(metadata, config);
  } else {
    output = outputTable(metadata, config);
  }
  return consoleLog(output);
};

const outputDifferences = (orig, curr) => {
  const differences =
    orig.length === 1 && curr.length === 1 ? diff.diffJson(orig[0], curr[0]) : diff.diffJson(orig, curr);

  let diffOut = '';
  differences.forEach(part => {
    let color = 'grey';
    if (part.added) {
      color = 'green';
    } else if (part.removed) {
      color = 'red';
    }
    // process.stderr.write(`  ${chalk[color](part.value).trim()}`);
    diffOut += `${chalk[color](part.value)}`;
  });
  return consoleLog(diffOut);
};

module.exports = { outputDifferences, outputMetadata };
