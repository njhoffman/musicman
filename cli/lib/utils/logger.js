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

const log = (logLevel, message) => {
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

const outputNotFound = (filters, target) => {
  let output = `\nNo mp3 files found in ${target} `;
  if (_.keys(filters).length > 0) {
    let filterStr = !_.isEmpty(filters.include) ? `include: ${JSON.stringify(filters.include)}, ` : '';
    filterStr += !_.isEmpty(filters.exclude) ? `exclude: ${JSON.stringify(filters.exclude)}, ` : '';
    filterStr +=
      filters.rating && (filters.rating.max || filters.rating.min) ? `rating: ${JSON.stringify(filters.rating)}, ` : '';
    output += filterStr ? `that match filters: \n\t${filterStr}` : '(no filters)';
  }
  return output;
};

const outputTable = (metadata, config) => {
  const columns = ['rating'].concat(
    _.chain(config.tags)
      .filter('tableOrder')
      .sortBy('tableOrder')
      .map('name')
      .value()
  );
  const { output: { table = {} } = {} } = config;
  const { seperators = {}, headers = {} } = table;

  // TODO: fork columnify and support colors
  // TODO: have better default config loading
  const columnOptions = {
    maxLineWidth: 'auto',
    showHeaders: headers.visible === false || true,
    columnSplitter: seperators.vertical || ' ',
    dataTransform: data => {
      // return chalk.hex('#ffffff')(`${data}`);
      return data;
    },
    headingTransform: heading => {
      const headerItem = headers.capitalize ? _.toUpper(heading) : _.upperFirst(heading);
      return headerItem;
      // return headers.color ? chalk.hex(headers.color)(headerItem) : headerItem;
    }
  };

  return columnify(metadata, { columns, ...columnOptions });
};

const outputMetadata = ({ metadata, target, options, config, format }) => {
  const { filters } = options;

  let output;
  if (metadata.length === 0) {
    output = outputNotFound(filters, target);
  } else if (format === 'vertical') {
    const configTagNames = _.map(config.tags, 'name').concat('rating');
    output = metadata.map(mItem => _.pick(mItem, configTagNames));
    output = metadata.length === 1 ? output[0] : output;
  } else {
    output = outputTable(metadata, config);
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
};

module.exports = {
  outputDifferences,
  outputMetadata,
  ...logger
};
