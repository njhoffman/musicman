const _ = require('lodash');
const chalk = require('chalk');
const diff = require('diff');
const { inspect } = require('util');

/* eslint-disable no-console */
const log = (errorLevel, message) => {
  let parsed = message;
  if (_.isObject(message)) {
    parsed = inspect(message, { colors: true, compact: false })
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n');
  }

  if (process.env.NODE_ENV !== 'test') {
    console.log(parsed);
  }
  return parsed;
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
  console.log(diffOut);
};
/* eslint-enable no-console */

module.exports = {
  outputDifferences,
  error: log.bind(null, 0),
  warn: log.bind(null, 1),
  info: log.bind(null, 2),
  debug: log.bind(null, 3),
  trace: log.bind(null, 4)
};
