const chalk = require('chalk');
const diff = require('diff');
const columnify = require('columnify');
const termSize = require('term-size');

const { consoleLog } = require('../utils/logger.cjs');

const columnifyDifferences = output => {
  const { NODE_ENV } = process.env;

  const options = {
    columns: ['key', 'value'],
    showHeaders: false,
    maxLineWidth: `${termSize().columns - 2}`,
    truncate: true
  };

  // console.log('output', output);
  if (NODE_ENV === 'test') {
    return output;
  }

  const keyRegEx = /([^:]+):(.*)$/;
  const parsedOut = output.split('\n').map(line => {
    if (!keyRegEx.test(line)) {
      return false;
    }
    const [key, value] = line.match(keyRegEx).slice(1, 3);
    return { key, value };
  });

  return columnify(parsedOut, options)
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
};

const outputDifferences = (orig, curr) => {
  const differences =
    orig.length === 1 && curr.length === 1 ? diff.diffJson(orig[0], curr[0]) : diff.diffJson(orig, curr);

  let diffOut = '';
  differences.forEach(part => {
    const value = part.value
      .split('\n')
      .map(line => line.replace(/,$/, '').replace(/"/g, ''))
      .join('\n');

    let color = 'grey';
    if (part.added) {
      color = 'green';
    } else if (part.removed) {
      color = 'red';
    }
    // process.stderr.write(`  ${chalk[color](part.value).trim()}`);
    diffOut += `${chalk[color](value)}`;
  });

  if (diffOut.includes('\n')) {
    diffOut = columnifyDifferences(diffOut);
  }

  return consoleLog(diffOut);
};

module.exports = { outputDifferences };
