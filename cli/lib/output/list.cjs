const _ = require('lodash');
const columnify = require('columnify');
const chalk = require('chalk');
const termSize = require('term-size');

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

const columnifyList = (output, config) => {
  const { NODE_ENV } = process.env;
  const { views: { list = {} } = {} } = config;
  const { headers = {} } = list;
  const options = {
    columns: ['key', 'value'],
    showHeaders: false,
    maxLineWidth: `${termSize().columns - 2}`,
    truncate: true,
    config: {
      key: {
        dataTransform: data => (headers.color ? chalk.hex(headers.color)(data) : data)
      },
      value: {
        dataTransform: data => (list.color ? chalk.hex(list.color)(data) : data)
      }
    }
  };

  return NODE_ENV === 'test'
    ? output
    : columnify(output, options)
        .split('\n')
        .map(line => `  ${line}`)
        .join('\n');
};

const outputList = (metadata, config) => {
  const columns = _.map(metadata, mItem => parseList(mItem, config));
  const output = columns.length === 1 ? columns[0] : columns;
  return columnifyList(output, config);
};

module.exports = { columnifyList, outputList };
