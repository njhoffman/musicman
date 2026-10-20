const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const globalTags = require('./tags.json');
const { ensureUserConfig, getUserConfigPath, readUserConfig, validateConfig, validateLibrary } = require('./validator');

const { version: pkgVersion } = require('../../package.json');

const defaultConfig = yaml.load(fs.readFileSync(path.resolve(__dirname, 'defaultConfig.yml'), 'utf8'));

// Map library.tags names to actual tag objects
// First check user's custom tags, then fall back to global tags.json
// This ensures we support both user-defined custom tags and standard ID3 tags
const resolveLibraryTags = (config) => {
  const resolved = _.map(config.library.tags, (name) => ({
    name,
    tag: _.find(config.tags || [], { name }) || _.find(globalTags, { name })
  }));
  return {
    tags: _.compact(_.map(resolved, 'tag')),
    missing: _.map(_.reject(resolved, 'tag'), 'name')
  };
};

// merged config with all validation errors and warnings, nothing is reported or exited here
const buildConfig = ({
  userConfigPath = getUserConfigPath(),
  create = false,
  userConfig,
  defaultConfig: baseConfig = defaultConfig
} = {}) => {
  if (create && !userConfig) {
    ensureUserConfig(userConfigPath);
  }
  const loadedConfig = userConfig || readUserConfig(userConfigPath);
  const { errors, warnings } = validateConfig(loadedConfig);

  // Arrays from the user config replace default arrays instead of merging by index
  const replaceArrays = (objValue, srcValue) => (_.isArray(srcValue) ? _.cloneDeep(srcValue) : undefined);
  const config = _.mergeWith(
    {},
    baseConfig,
    loadedConfig,
    { version: pkgVersion, env: process.env.NODE_ENV },
    replaceArrays
  );

  // database files default to the music library directory
  const expandHome = (file) => (file && file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file);
  const baseDirectory = _.get(config, 'mpd.baseDirectory');
  const libraryFile = (name) => (baseDirectory ? path.join(baseDirectory, name) : null);
  config.db = {
    ...config.db,
    path: expandHome(_.get(config, 'db.path')) || libraryFile('musicman.sqlite'),
    backupDirectory: expandHome(_.get(config, 'db.backupDirectory')) || libraryFile('.musicman')
  };

  const musicmanFile = (name) => (baseDirectory ? path.join(baseDirectory, '.musicman', name) : null);
  config.sync = {
    ...config.sync,
    uploadDirectory: expandHome(_.get(config, 'sync.uploadDirectory')) || musicmanFile('upload'),
    downloadDirectory: expandHome(_.get(config, 'sync.downloadDirectory')) || musicmanFile('download'),
    beetsConfig: expandHome(_.get(config, 'sync.beetsConfig'))
  };

  const logFileName = expandHome(_.get(config, 'logger.file.name'));
  if (logFileName) {
    config.logger.file.name = path.isAbsolute(logFileName) ? logFileName : libraryFile(logFileName);
  }

  const { tags, missing } = resolveLibraryTags(config);
  config.library.tags = tags;
  errors.push(...validateLibrary(config, missing));

  return { config, errors, warnings };
};

/**
 * Validates the user config (~/.musicmanrc.yml) without exiting, returns { errors, warnings }.
 */
const checkConfig = (options) => _.pick(buildConfig(options), ['errors', 'warnings']);

/**
 * Loads the user config (~/.musicmanrc.yml) merged over the default config.
 *
 * Nothing is read or written until this is called. `create` copies the default config to the
 * user config path if it does not exist yet. `userConfig` and `defaultConfig` replace reading
 * those files, which keeps tests independent of the developer's own config.
 *
 * Validation warnings are printed; any validation error is fatal after all errors are printed.
 */
const loadConfig = (options = {}) => {
  const { userConfigPath = getUserConfigPath() } = options;
  const { config, errors, warnings } = buildConfig(options);

  if (warnings.length > 0) {
    console.warn(`Found ${warnings.length} configuration warnings in ${userConfigPath}:`);
    warnings.forEach((warning) => console.warn(`  - ${warning}`));
  }

  if (errors.length > 0) {
    errors.forEach((error) => console.error(`Fatal error: ${error}`));
    console.error(`Fix ${userConfigPath} and run again`);
    process.exit(1);
  }

  return config;
};

module.exports = { checkConfig, defaultConfig, loadConfig };
