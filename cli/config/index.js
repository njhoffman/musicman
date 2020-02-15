// TODO: validate configuration, prevent reserved tag names
const _ = require('lodash');
const path = require('path');
const { cosmiconfigSync } = require('cosmiconfig');
const appName = require('../package.json').name;

// You can also search and load synchronously.
const explorerSync = cosmiconfigSync(appName);
const { config, filepath } = explorerSync.search();

if (filepath) {
  /* eslint-disable no-console */
  console.log(`Loaded configuration from: ${filepath}`);
  /* eslint-enable no-console */
}

const { config: defaultConfig } = explorerSync.load(path.resolve(__dirname, 'defaultConfig.yml'));

module.exports = _.defaultsDeep(defaultConfig, config);
