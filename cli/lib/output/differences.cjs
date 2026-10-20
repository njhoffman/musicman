const _ = require('lodash');
const chalk = require('chalk');
const diff = require('diff');
const { renderKeyValues } = require('./render.cjs');
const termSize = require('term-size');

const { consoleLog } = require('../utils/logger.cjs');

const diffColor = part => {
  if (part.added) {
    return 'green';
  }
  return part.removed ? 'red' : 'grey';
};

const cleanDiffValue = value =>
  value
    .split('\n')
    .map(line => line.replace(/,$/, '').replace(/"/g, ''))
    .join('\n');

// render key/value lines from plain diff parts, coloring each line after layout
const formatDifferences = differences => {
  const keyRegEx = /([^:]+):(.*)$/;
  const lines = _.flatMap(differences, part =>
    _.map(cleanDiffValue(part.value).split('\n'), text => ({ text, color: diffColor(part) }))
  ).filter(({ text }) => keyRegEx.test(text));

  const colorLine = (cell, rowIndex) => chalk[lines[rowIndex].color](cell);
  return renderKeyValues(
    _.map(lines, ({ text }) => text.match(keyRegEx).slice(1, 3)),
    termSize().columns - 2,
    { formatKey: colorLine, formatValue: colorLine }
  )
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
};

const outputDifferences = (orig, curr) => {
  const differences =
    orig.length === 1 && curr.length === 1
      ? diff.diffJson(orig[0], curr[0])
      : diff.diffJson(orig, curr);

  const diffOut = _.map(differences, part => chalk[diffColor(part)](cleanDiffValue(part.value))).join('');

  const output =
    diffOut.includes('\n') && process.env.NODE_ENV !== 'test'
      ? formatDifferences(differences)
      : diffOut;

  return consoleLog(output);
};

module.exports = { formatDifferences, outputDifferences };
