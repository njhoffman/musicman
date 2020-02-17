// TODO: validate configuration, prevent reserved tag names
const _ = require('lodash');
const path = require('path');
const { cosmiconfigSync } = require('cosmiconfig');
const tags = require('./tags.json');

const { name, version } = require('../../package.json');

// You can also search and load synchronously.
const explorerSync = cosmiconfigSync(name);
const { config, filepath } = explorerSync.search() || {};

if (filepath) {
  /* eslint-disable no-console */
  console.log(` Loaded configuration from: ${filepath}`);
  /* eslint-enable no-console */
}

const { config: defaultConfig, filepath: fp } = explorerSync.load(path.resolve(__dirname, 'defaultConfig.yml'));
const env = process.env.NODE_ENV;

defaultConfig.library.tags = _.map(
  ['popularity', 'volume', 'artist', 'title', 'year', 'genre', 'mood', 'copyright', 'album'],
  name => _.find(tags, { name })
);

module.exports = _.defaultsDeep({ version, env }, config, defaultConfig);
