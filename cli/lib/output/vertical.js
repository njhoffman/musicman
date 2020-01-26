const _ = require('lodash');
const columnify = require('columnify');
const chalk = require('chalk');

const parseVertical = (mItem, config) => {
  const splitMulti = false;
  const configTagNames = _.map(config.tags, 'name').concat('rating');
  return _.mapValues(_.pick(mItem, configTagNames), (val, key) => {
    const tag = _.find(config.tags, { name: key });

    if (tag && tag.multi && splitMulti) {
      return val.split(',');
    }
    return val;
  });
};

const columnifyVertical = (output, config) => {
  const { NODE_ENV } = process.env;
  const { output: { vertical } = {} } = config;
  const options = {
    columns: ['key', 'value'],
    showHeaders: false,
    maxLineWidth: 'auto',
    truncate: true,
    config: {
      key: {
        dataTransform: data => (vertical.headers.color ? chalk.hex(vertical.headers.color)(data) : data)
      },
      value: {
        dataTransform: data => (vertical.color ? chalk.hex(vertical.color)(data) : data)
      }
    }
  };

  return NODE_ENV === 'test'
    ? output
    : columnify(output, options)
        .split('\n')
        .map(line => `    ${line}`)
        .join('\n');
};

const outputVertical = (metadata, config) => {
  const columns = _.map(metadata, mItem => parseVertical(mItem, config));
  const output = columns.length === 1 ? columns[0] : columns;
  return columnifyVertical(output, config);
};

module.exports = { columnifyVertical, outputVertical };
