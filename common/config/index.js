const _ = require('lodash');
const path = require('path');
const { cosmiconfigSync } = require('cosmiconfig');
const globalTags = require('./tags.json');
const { initializeConfig } = require('./validator');

const { name: pkgName, version: pkgVersion } = require('../../package.json');

const fatal = message => {
  console.error(`Fatal error: ${message}`);
  process.exit(1);
};

// Initialize and validate config on startup
initializeConfig();

// You can also search and load synchronously.
const explorerSync = cosmiconfigSync(pkgName);
const { config = {}, filepath } = explorerSync.search() || {};

const { config: defaultConfig, filepath: fp } = explorerSync.load(path.resolve(__dirname, 'defaultConfig.yml'));
const env = process.env.NODE_ENV;

// Display settings moved from output.table/output.vertical and tags[].tableOrder into views
const legacyKeys = _.compact([
  _.has(config, 'output.table') && 'output.table (moved to views.table)',
  _.has(config, 'output.vertical') && 'output.vertical (moved to views.list)',
  _.some(config.tags, tag => _.has(tag, 'tableOrder')) &&
    'tags[].tableOrder (column order is now set by views.table.tags)'
]);
if (legacyKeys.length > 0) {
  fatal(`Outdated configuration options in ${filepath}:\n  - ${legacyKeys.join('\n  - ')}`);
}

// Arrays from the user config replace default arrays instead of merging by index
const replaceArrays = (objValue, srcValue) => (_.isArray(srcValue) ? srcValue : undefined);
const finalConfig = _.mergeWith({}, defaultConfig, config, { version: pkgVersion, env }, replaceArrays);

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
      fatal(`Tag '${name}' defined in library.tags but not found in user tags or global tags.json`);
    }
    return tag;
  })
);

// Views can only display library tags, plus rating which is configured separately
const viewableTags = ['rating'].concat(_.map(finalConfig.library.tags, 'name'));
_.each(finalConfig.views, (view, viewName) => {
  _.each(view.tags, ({ name }) => {
    if (!viewableTags.includes(name)) {
      fatal(`Tag '${name}' defined in views.${viewName}.tags but not found in library.tags`);
    }
  });
});

module.exports = finalConfig;
