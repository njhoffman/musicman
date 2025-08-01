const _ = require('lodash');
const path = require('path');
const { cosmiconfigSync } = require('cosmiconfig');
const globalTags = require('./tags.json');
const { initializeConfig } = require('./validator');

const { name: pkgName, version: pkgVersion } = require('../../package.json');

// Initialize and validate config on startup
initializeConfig();

// You can also search and load synchronously.
const explorerSync = cosmiconfigSync(pkgName);
const { config, filepath } = explorerSync.search() || {};

const { config: defaultConfig, filepath: fp } = explorerSync.load(path.resolve(__dirname, 'defaultConfig.yml'));
const env = process.env.NODE_ENV;

// Merge configs first to get final library.tags configuration
const finalConfig = _.defaultsDeep({ version: pkgVersion, env }, config, defaultConfig);

// Map library.tags names to actual tag objects
// First check user's custom tags, then fall back to global tags.json
// This ensures we support both user-defined custom tags and standard ID3 tags
finalConfig.library.tags = _.compact(
  _.map(finalConfig.library.tags, name => {
    // First look in user's custom tags configuration
    let tag = _.find(finalConfig.tags || [], { name });

    // If not found in user tags, look in global tags.json
    if (!tag) {
      tag = _.find(globalTags, { name });
    }

    if (!tag) {
      console.error(
        `Fatal error: Tag '${name}' defined in library.tags but not found in user tags or global tags.json`
      );
      process.exit(1);
    }
    return tag;
  })
);

module.exports = finalConfig;
