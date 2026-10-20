const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const globalTags = require('./tags.json');
const { ensureUserConfig, getUserConfigPath, readUserConfig, validateConfig } = require('./validator');

const { version: pkgVersion } = require('../../package.json');

const defaultConfig = yaml.load(fs.readFileSync(path.resolve(__dirname, 'defaultConfig.yml'), 'utf8'));

const fatal = message => {
  console.error(`Fatal error: ${message}`);
  process.exit(1);
};

// Display settings moved from output.table/output.vertical and tags[].tableOrder into views
const checkLegacyKeys = (userConfig, userConfigPath) => {
  const legacyKeys = _.compact([
    _.has(userConfig, 'output.table') && 'output.table (moved to views.table)',
    _.has(userConfig, 'output.vertical') && 'output.vertical (moved to views.list)',
    _.some(userConfig.tags, tag => _.has(tag, 'tableOrder')) &&
      'tags[].tableOrder (column order is now set by views.table.tags)'
  ]);
  if (legacyKeys.length > 0) {
    fatal(`Outdated configuration options in ${userConfigPath}:\n  - ${legacyKeys.join('\n  - ')}`);
  }
};

// Map library.tags names to actual tag objects
// First check user's custom tags, then fall back to global tags.json
// This ensures we support both user-defined custom tags and standard ID3 tags
const resolveLibraryTags = config =>
  _.compact(
    _.map(config.library.tags, name => {
      // First look in user's custom tags configuration
      let tag = _.find(config.tags || [], { name });

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

const checkLibraryTags = libraryTags => {
  // Library tags are read and written as strings, so only text and custom text frames are supported
  const isTextFrame = id => /^T(?!XXX$)[A-Z0-9]{3}$/.test(id) || /^TXXX\..+/.test(id);
  _.each(libraryTags, ({ name, id }) => {
    if (!isTextFrame(id)) {
      fatal(
        `Tag '${name}' in library.tags uses frame '${id}', only text (T***) and custom (TXXX.*) frames are supported`
      );
    }
  });

  // Each frame can only map to one tag name
  _.each(_.groupBy(libraryTags, 'id'), (tags, id) => {
    if (tags.length > 1) {
      fatal(`Tags '${_.map(tags, 'name').join("', '")}' in library.tags share frame '${id}'`);
    }
  });
};

// Views can only display library tags, plus rating which is configured separately
const checkViewTags = config => {
  const viewableTags = ['rating'].concat(_.map(config.library.tags, 'name'));
  _.each(config.views, (view, viewName) => {
    _.each(view.tags, ({ name }) => {
      if (!viewableTags.includes(name)) {
        fatal(`Tag '${name}' defined in views.${viewName}.tags but not found in library.tags`);
      }
    });
  });
};

/**
 * Loads the user config (~/.musicmanrc.yml) merged over the default config.
 *
 * Nothing is read or written until this is called. `create` copies the default config to the
 * user config path if it does not exist yet. `userConfig` and `defaultConfig` replace reading
 * those files, which keeps tests independent of the developer's own config.
 */
const loadConfig = ({
  userConfigPath = getUserConfigPath(),
  create = false,
  userConfig,
  defaultConfig: baseConfig = defaultConfig
} = {}) => {
  if (create && !userConfig) {
    ensureUserConfig(userConfigPath);
  }
  const loadedConfig = userConfig || readUserConfig(userConfigPath);

  const validationErrors = validateConfig(loadedConfig);
  if (validationErrors.length > 0) {
    console.warn(`Found ${validationErrors.length} configuration validation issues in ${userConfigPath}:`);
    validationErrors.forEach(error => console.warn(`  - ${error}`));
  }

  checkLegacyKeys(loadedConfig, userConfigPath);

  // Arrays from the user config replace default arrays instead of merging by index
  const replaceArrays = (objValue, srcValue) => (_.isArray(srcValue) ? _.cloneDeep(srcValue) : undefined);
  const config = _.mergeWith(
    {},
    baseConfig,
    loadedConfig,
    { version: pkgVersion, env: process.env.NODE_ENV },
    replaceArrays
  );

  config.library.tags = resolveLibraryTags(config);
  checkLibraryTags(config.library.tags);
  checkViewTags(config);

  return config;
};

module.exports = { defaultConfig, loadConfig };
