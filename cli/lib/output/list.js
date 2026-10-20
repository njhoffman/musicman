const _ = require('lodash');
const chalk = require('chalk').default;
const termSize = require('term-size').default;
const { renderKeyValues } = require('./render.js');

const parseList = (mItem, config) => {
  const splitMulti = false;
  const viewTagNames = _.map(_.get(config, 'views.list.tags'), 'name');

  return _.mapValues(_.pick(mItem, viewTagNames), (val, key) => {
    const tag = _.find(_.get(config, 'library.tags'), { name: key });

    if (tag && tag.multi && splitMulti) {
      return val.split(',');
    }
    return val;
  });
};

// render key/value lines for each file, separated by a blank line
const formatList = (output, config) => {
  const { views: { list = {} } = {} } = config;
  const { headers = {} } = list;
  const formatKey = key => (headers.color ? chalk.hex(headers.color)(key) : key);
  const formatValue = value => (list.color ? chalk.hex(list.color)(value) : value);

  return _.map([].concat(output), item =>
    renderKeyValues(
      _.map(_.toPairs(item), ([key, value]) => [key, _.isNil(value) ? '' : String(value)]),
      termSize().columns - 2,
      { formatKey, formatValue }
    )
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n')
  ).join('\n\n');
};

const outputList = (metadata, config) => {
  const columns = _.map(metadata, mItem => parseList(mItem, config));
  const output = columns.length === 1 ? columns[0] : columns;
  return process.env.NODE_ENV === 'test' ? output : formatList(output, config);
};

module.exports = { formatList, outputList };
