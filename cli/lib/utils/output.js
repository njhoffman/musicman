const _ = require('lodash');
const chalk = require('chalk');
const diff = require('diff');
const columnify = require('columnify');

const { consoleLog } = require('./logger');

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
  // TODO: yuck, wait patiently for optional chaining
  const { output: { table = {} } = {} } = config;
  const { seperators = {}, headers = {} } = table;

  // TODO: have better default config loading
  const columnifyOptions = {
    maxLineWidth: 'auto',
    truncate: true,
    showHeaders: headers.visible === false || true,
    columnSplitter: seperators.vertical || ' ',
    headingTransform: heading => {
      const headerItem = headers.capitalize ? _.toUpper(heading) : _.upperFirst(heading);
      // return headerItem;
      return chalk.hex('#33CCAA')(headerItem);
    }
  };

  // always include rating column, place it first if not otherwise defined
  const ratingColumn = { ...config.rating, name: 'rating', tableOrder: -1 };
  // sorty and only include columns that have tableOrder property
  const columns = _.sortBy([ratingColumn].concat(_.filter(config.tags, 'tableOrder')), 'tableOrder');

  // prepare columns configuration for columnify
  const columnsConfig = {};
  _.each(columns, tag => {
    const cellColor = tag.color || table.color;
    const dataTransform = data => {
      const emptyCell = (_.isArray(data) && data.filter(Boolean).length === 0) || data.trim().length === 0;
      if (cellColor && !emptyCell) {
        return chalk.hex(cellColor)(data);
      }
      return data;
    };
    columnsConfig[tag.name] = {
      dataTransform,
      ..._.pick(tag, ['showHeaders', 'maxWidth', 'minWidth'])
    };
  });

  const columnifyConfig = { columns: _.map(columns, 'name'), config: columnsConfig, ...columnifyOptions };
  return columnify(metadata, columnifyConfig);
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
