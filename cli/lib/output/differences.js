const chalk = require('chalk');
const diff = require('diff');

const { consoleLog } = require('../utils/logger');

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

module.exports = { outputDifferences };
