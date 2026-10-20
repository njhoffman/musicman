const _ = require('lodash');
const chalk = require('chalk').default;
const { renderColumns } = require('./render.js');
const { availableWidth } = require('../utils/logger.js');

const outputTable = (metadata, config) => {
  const { views: { table = {} } = {} } = config;
  const { seperators = {}, headers = {}, tags: viewTags = [] } = table;

  const formatHeader = name => (headers.capitalize ? _.toUpper(name) : _.upperFirst(name));
  const colorHeader = header => (headers.color ? chalk.hex(headers.color)(header) : header);

  // columns in view order, view entries override attributes of the tag definition
  const columns = _.map(viewTags, viewTag =>
    viewTag.name === 'rating'
      ? { ...config.rating, align: 'center', ...viewTag }
      : { ..._.find(_.get(config, 'library.tags'), { name: viewTag.name }), ...viewTag }
  );

  // dont show columns that have all empty cells
  const filteredColumns = _.filter(columns, ({ name }) =>
    _.some(metadata, meta => !_.isEmpty(meta[name]))
  );

  const formatCell = tag => cell => {
    const cellColor = tag.color || table.color;
    return cellColor && cell.trim().length > 0 ? chalk.hex(cellColor)(cell) : cell;
  };

  return renderColumns({
    head:
      headers.visible === false
        ? undefined
        : _.map(filteredColumns, tag => (tag.showHeaders === false ? '' : formatHeader(tag.name))),
    rows: _.map(metadata, meta =>
      _.map(filteredColumns, ({ name }) => (_.isNil(meta[name]) ? '' : String(meta[name])))
    ),
    columns: _.map(filteredColumns, tag => ({
      ..._.pick(tag, ['maxWidth', 'minWidth', 'align']),
      format: formatCell(tag),
      formatHeader: colorHeader
    })),
    splitter: _.isString(seperators.vertical) ? seperators.vertical : ' ',
    maxLineWidth: availableWidth()
  });
};

module.exports = { outputTable };
