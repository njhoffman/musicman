const _ = require('lodash');
const chalk = require('chalk');
const diff = require('diff');
const { inspect } = require('util');
const columnify = require('columnify');

/* eslint-disable no-console */
const consoleLog = msg => {
  const { NODE_ENV, NODE_TEST_LOG } = process.env;
  if (NODE_ENV !== 'test' && !NODE_TEST_LOG) {
    console.log(msg);
  }
  return msg;
};
/* eslint-enable no-console */

const log = (errorLevel, message) => {
  let parsed = message;
  if (_.isObject(message)) {
    parsed = inspect(message, { colors: true, compact: false })
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n');
  }

  return consoleLog(parsed);
};

const logger = {
  error: log.bind(null, 0),
  warn: log.bind(null, 1),
  info: log.bind(null, 2),
  debug: log.bind(null, 3),
  trace: log.bind(null, 4)
};

const outputMetadata = ({ metadata, target, options, config, format }) => {
  const { filters } = options;
  let output = '';
  const configTags = _.map(config.tags, 'name').concat('rating');
  if (metadata.length === 0) {
    output = `\nNo mp3 files found in ${target} `;
    if (_.keys(filters).length > 0) {
      let filterStr = !_.isEmpty(filters.include) ? `include: ${JSON.stringify(filters.include)}, ` : '';
      filterStr += !_.isEmpty(filters.exclude) ? `exclude: ${JSON.stringify(filters.exclude)}, ` : '';
      filterStr +=
        filters.rating && (filters.rating.max || filters.rating.min)
          ? `rating: ${JSON.stringify(filters.rating)}, `
          : '';
      output += filterStr ? `that match filters: \n\t${filterStr}` : '(no filters)';
    }
  } else if (format === 'vertical') {
    output = metadata.map(mItem => _.pick(mItem, configTags));
    output = metadata.length === 1 ? output[0] : output;
  } else {
    const columns = ['rating'].concat(
      _.chain(config.tags)
        .filter('viewIndex')
        .sortBy('viewIndex')
        .map('name')
        .value()
    );
    output = columnify(metadata, { columns, maxLineWidth: 'auto' });
  }
  return logger.info(output);
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
  return logger.info(diffOut);
  // consoleLog(diffOut);
};

module.exports = {
  outputDifferences,
  outputMetadata,
  ...logger
};
