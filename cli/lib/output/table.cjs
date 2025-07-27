const _ = require('lodash');
const chalk = require('chalk');
const columnify = require('columnify');

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
      return headers.color ? chalk.hex(headers.color)(headerItem) : headerItem;
    }
  };

  // always include rating column, place it first if not otherwise defined
  const ratingColumn = { ...config.rating, name: 'rating', tableOrder: -1, align: 'center' };
  // sorty and only include columns that have tableOrder property
  const columns = _.sortBy(
    [ratingColumn].concat(_.filter(config.tags, 'tableOrder')),
    'tableOrder'
  );

  // prepare columns configuration for columnify
  const columnsConfig = {};
  _.each(columns, tag => {
    const cellColor = tag.color || table.color;
    const dataTransform = data => {
      const emptyCell =
        (_.isArray(data) && data.filter(Boolean).length === 0) || data.trim().length === 0;
      if (cellColor && !emptyCell) {
        return chalk.hex(cellColor)(data);
      }
      return data;
    };
    columnsConfig[tag.name] = {
      dataTransform,
      ..._.pick(tag, ['showHeaders', 'maxWidth', 'minWidth', 'align'])
    };
  });

  // dont show columns that have all empty cells
  const filteredColumns = _.map(columns, 'name').filter(columnName =>
    _.some(metadata, meta => !_.isEmpty(meta[columnName]))
  );

  const columnifyConfig = { columns: filteredColumns, config: columnsConfig, ...columnifyOptions };
  return columnify(metadata, columnifyConfig);
};

module.exports = { outputTable };
