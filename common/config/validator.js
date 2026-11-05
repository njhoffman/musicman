const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');
const globalTags = require('./tags.json');

// Use console for logging since common doesn't have logger

// log level names from least to most detailed, used by output.verbosity and logger.file.level
const logLevels = ['error', 'warn', 'info', 'debug', 'trace'];

// Schema definition for config validation
const configSchema = {
  delimiter: { type: 'string', required: false },
  playlist: {
    type: 'object',
    properties: {
      outputPath: { type: 'string', required: false },
      outputDirectory: { type: 'string', required: false }
    }
  },
  mpd: {
    type: 'object',
    properties: {
      port: { type: 'number', min: 1, max: 65535, required: false },
      host: { type: 'string', required: false },
      baseDirectory: { type: 'string', required: false }
    }
  },
  db: {
    type: 'object',
    properties: {
      path: { type: 'string', required: false },
      backupDirectory: { type: 'string', required: false },
      autoBackup: { type: 'boolean', required: false },
      backupInterval: { type: 'string', required: false },
      backupCount: { type: 'number', min: 1, required: false }
    }
  },
  history: {
    type: 'object',
    properties: {
      keep: { type: 'number', min: 1, required: false }
    }
  },
  sync: {
    type: 'object',
    properties: {
      likedRating: { type: 'number', min: 0, required: false },
      scope: { type: 'string', required: false },
      playlists: { type: 'array', required: false },
      uploadDirectory: { type: 'string', required: false },
      phone: {
        type: 'object',
        required: false,
        properties: {
          device: { type: 'string', required: true },
          directory: { type: 'string', required: false }
        }
      },
      downloadDirectory: { type: 'string', required: false },
      spotdlCommand: { type: 'string', required: false },
      beetsConfig: { type: 'string', required: false },
      importLyrics: { type: 'boolean', required: false },
      autoAcceptPercent: { type: 'number', min: 0, max: 100, required: false },
      ignorePlaylist: { type: 'string', required: false }
    }
  },
  menu: {
    type: 'object',
    properties: {
      theme: { type: 'string', required: false },
      rofiArgs: { type: 'array', required: false },
      buttons: { type: 'array', required: false },
      ratings: { type: 'array', required: false },
      tagFields: { type: 'array', required: false },
      tagMinSongs: { type: 'number', min: 0, required: false },
      extraTags: { type: 'array', required: false }
    }
  },
  status: {
    type: 'object',
    properties: {
      icons: { type: 'boolean', required: false }
    }
  },
  shuffle: {
    type: 'object',
    properties: {
      playlist: { type: 'string', required: false },
      listSize: { type: 'number', min: 1, required: false }
    }
  },
  ui: {
    type: 'object',
    properties: {
      port: { type: 'number', min: 1, max: 65535, required: false }
    }
  },
  check: {
    type: 'object',
    properties: {
      rareCount: { type: 'number', min: 1, required: false },
      names: { type: 'array', required: false }
    }
  },
  spotify: {
    type: 'object',
    properties: {
      clientId: { type: 'string', required: false },
      clientSecret: { type: 'string', required: false },
      redirectUri: { type: 'string', required: false },
      refreshDays: { type: 'number', min: 1, required: false },
      requestsPerSecond: { type: 'number', min: 0, required: false },
      fields: { type: 'array', required: false },
      artistImageDirectory: { type: 'string', required: false },
      ignore: { type: 'array', required: false }
    }
  },
  backup: {
    type: 'object',
    properties: {
      directory: { type: 'string', required: false },
      exclude: { type: 'array', required: false },
      keepReplaced: { type: 'number', min: 0, required: false },
      keepRemovedDays: { type: 'number', min: 0, required: false }
    }
  },
  analyze: {
    type: 'object',
    properties: {
      fields: { type: 'array', required: false },
      workers: { type: 'number', min: 1, required: false }
    }
  },
  features: {
    type: 'object',
    properties: {
      fields: { type: 'array', required: false }
    }
  },
  daemon: {
    type: 'object',
    properties: {
      duration: { type: 'number', min: 0, required: false },
      bin: { type: 'string', required: false },
      urgency: { type: 'string', enum: ['LOW', 'NORMAL', 'CRITICAL'], required: false },
      icon: { type: 'boolean', required: false },
      fields: { type: 'array', required: false }
    }
  },
  bar: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', required: false },
      maxLength: { type: 'number', min: 1, required: false },
      colors: { type: 'object', required: false }
    }
  },
  rating: {
    type: 'object',
    properties: {
      tag: { type: 'string', required: false },
      email: { type: 'string', required: false },
      max: { type: 'number', min: 1, max: 10, required: false },
      color: { type: 'string', required: false }
    }
  },
  output: {
    type: 'object',
    properties: {
      verbosity: { type: 'string', enum: logLevels, required: false },
      padding: { type: 'number', min: 0, required: false }
    }
  },
  stats: {
    type: 'object',
    properties: {
      multiFields: { type: 'array', required: false },
      filters: { type: 'array', required: false }
    }
  },
  tags: { type: 'array', required: false },
  library: {
    type: 'object',
    properties: {
      basePath: { type: 'string', required: false },
      tags: { type: 'array', required: false }
    }
  },
  views: {
    type: 'object',
    properties: {
      table: {
        type: 'object',
        properties: {
          color: { type: 'string', required: false },
          headers: { type: 'object', required: false },
          separators: { type: 'object', required: false },
          tags: { type: 'array', required: false }
        },
        required: false
      },
      list: {
        type: 'object',
        properties: {
          color: { type: 'string', required: false },
          headers: { type: 'object', required: false },
          tags: { type: 'array', required: false }
        },
        required: false
      }
    }
  },
  logger: {
    type: 'object',
    properties: {
      colors: {
        type: 'object',
        properties: {
          fatal: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: {
                type: 'string',
                enum: ['normal', 'bold', 'italic', 'underline'],
                required: false
              }
            },
            required: false
          },
          error: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: {
                type: 'string',
                enum: ['normal', 'bold', 'italic', 'underline'],
                required: false
              }
            },
            required: false
          },
          warn: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: {
                type: 'string',
                enum: ['normal', 'bold', 'italic', 'underline'],
                required: false
              }
            },
            required: false
          },
          log: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: {
                type: 'string',
                enum: ['normal', 'bold', 'italic', 'underline'],
                required: false
              }
            },
            required: false
          },
          info: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: {
                type: 'string',
                enum: ['normal', 'bold', 'italic', 'underline'],
                required: false
              }
            },
            required: false
          },
          debug: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: {
                type: 'string',
                enum: ['normal', 'bold', 'italic', 'underline'],
                required: false
              }
            },
            required: false
          },
          trace: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: {
                type: 'string',
                enum: ['normal', 'bold', 'italic', 'underline'],
                required: false
              }
            },
            required: false
          }
        },
        required: false
      },
      file: {
        type: 'object',
        properties: {
          name: { type: 'string', required: false },
          level: { type: 'string', enum: logLevels, required: false }
        },
        required: false
      },
      archive: {
        type: 'object',
        properties: {
          directory: { type: 'string', required: false },
          level: { type: 'string', enum: logLevels, required: false },
          keep: { type: 'number', min: 1, required: false }
        },
        required: false
      }
    },
    required: false
  }
};

const intervalUnits = { minute: 60 * 1000, hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };
intervalUnits.week = 7 * intervalUnits.day;

/**
 * Parses an interval like '1 day' or '12 hours' into milliseconds, null when invalid
 */
function parseInterval(interval) {
  const match = `${interval}`.trim().match(/^(\d+)\s*(minute|hour|day|week)s?$/i);
  return match ? Number(match[1]) * intervalUnits[match[2].toLowerCase()] : null;
}

/**
 * Spotify playlist id from a playlist URL, spotify:playlist: URI, or bare id; null when invalid
 */
function parsePlaylistId(playlist) {
  const match = `${playlist}`.trim().match(/(?:playlist[/:])?([A-Za-z0-9]{22})(?:[?/].*)?$/);
  return match ? match[1] : null;
}

// options moved or renamed, reported as errors with where they went
const legacyOptions = {
  'output.table': 'moved to views.table',
  'output.vertical': 'moved to views.list',
  'views.table.seperators': 'renamed to views.table.separators'
};

/**
 * Validates a value against a schema definition.
 * Wrong types and values are errors, unknown options are warnings.
 */
function validateValue(value, schema, path = '') {
  const result = { errors: [], warnings: [] };

  if (schema.required && (value === undefined || value === null)) {
    result.errors.push(`${path} is required`);
    return result;
  }

  if (value === undefined || value === null) {
    return result;
  }

  // Type validation, values limited to an enum only report the enum
  if (schema.type === 'string' && typeof value !== 'string' && !schema.enum) {
    result.errors.push(`${path} must be a string`);
  } else if (schema.type === 'number' && typeof value !== 'number') {
    result.errors.push(`${path} must be a number`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    result.errors.push(`${path} must be a boolean`);
  } else if (schema.type === 'array' && !Array.isArray(value)) {
    result.errors.push(`${path} must be an array`);
  } else if (schema.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
    result.errors.push(`${path} must be an object`);
  }

  // Range validation for numbers
  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.min !== undefined && value < schema.min) {
      result.errors.push(`${path} must be >= ${schema.min}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      result.errors.push(`${path} must be <= ${schema.max}`);
    }
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(value)) {
    result.errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
  }

  // Object property validation
  if (schema.type === 'object' && schema.properties && typeof value === 'object') {
    Object.keys(value).forEach(key => {
      const keyPath = `${path}.${key}`;
      if (legacyOptions[keyPath]) {
        result.errors.push(`${keyPath} is no longer supported (${legacyOptions[keyPath]})`);
      } else if (!schema.properties[key]) {
        result.warnings.push(`${keyPath} is not a valid configuration option`);
      } else {
        const nested = validateValue(value[key], schema.properties[key], keyPath);
        result.errors.push(...nested.errors);
        result.warnings.push(...nested.warnings);
      }
    });
  }

  return result;
}

/**
 * Validates a user config object against the schema, returns { errors, warnings }
 */
function validateConfig(config) {
  const result = { errors: [], warnings: [] };

  Object.keys(config).forEach(key => {
    if (!configSchema[key]) {
      result.warnings.push(`${key} is not a valid configuration option`);
    } else {
      const field = validateValue(config[key], configSchema[key], key);
      result.errors.push(...field.errors);
      result.warnings.push(...field.warnings);
    }
  });

  const backupInterval = _.get(config, 'db.backupInterval');
  if (_.isString(backupInterval) && parseInterval(backupInterval) === null) {
    result.errors.push(
      `db.backupInterval '${backupInterval}' must be a number of minutes, hours, days, or weeks (e.g. '1 day')`
    );
  }

  _.each(_.get(config, 'stats.filters', []), (entry, i) => {
    if (!_.isPlainObject(entry) || !_.isString(entry.name) || !_.isString(entry.filter)) {
      result.errors.push(`stats.filters[${i}] must have a name and a filter`);
    }
  });

  _.each(_.get(config, 'sync.playlists', []), (entry, i) => {
    if (!_.isPlainObject(entry) || !_.isString(entry.filter) || !_.isString(entry.playlist)) {
      result.errors.push(`sync.playlists[${i}] must have a filter and a playlist`);
    } else if (!parsePlaylistId(entry.playlist)) {
      result.errors.push(
        `sync.playlists[${i}].playlist '${entry.playlist}' is not a Spotify playlist URL or id`
      );
    }
  });

  const featureFields = [
    'acousticness',
    'danceability',
    'energy',
    'instrumentalness',
    'key',
    'liveness',
    'loudness',
    'speechiness',
    'tempo',
    'valence'
  ];
  _.each(_.get(config, 'features.fields', []), (field, i) => {
    if (!featureFields.includes(field)) {
      result.errors.push(
        `features.fields[${i}] '${field}' must be one of ${featureFields.join(', ')}`
      );
    }
  });

  const analyzeFields = [
    'tempo',
    'key',
    'danceability',
    'mood_happy',
    'mood_sad',
    'mood_relaxed',
    'mood_aggressive',
    'mood_party'
  ];
  _.each(_.get(config, 'analyze.fields', []), (field, i) => {
    if (!analyzeFields.includes(field)) {
      result.errors.push(
        `analyze.fields[${i}] '${field}' must be one of ${analyzeFields.join(', ')}`
      );
    }
  });

  const reservedFields = ['sp_track_id', 'sp_fetched_at', 'sp_diff_percent', 'sp_diff_details'];
  _.each(_.get(config, 'spotify.fields', []), (field, i) => {
    if (!_.isPlainObject(field) || !_.isString(field.path) || !_.isString(field.name)) {
      result.errors.push(`spotify.fields[${i}] must have a path and a name`);
    } else if (!/^(track|album|artist)\./.test(field.path)) {
      result.errors.push(
        `spotify.fields[${i}].path '${field.path}' must start with track., album., or artist.`
      );
    } else if (!/^[\w-]+$/.test(field.name)) {
      result.errors.push(
        `spotify.fields[${i}].name '${field.name}' can only contain letters, digits, _ and -`
      );
    } else if (reservedFields.includes(field.name)) {
      result.errors.push(
        `spotify.fields[${i}].name '${field.name}' is always written and cannot be mapped`
      );
    }
    _.each(['scope', 'fallbackScope'], key => {
      if (_.isPlainObject(field) && _.has(field, key) && field[key] !== 'album') {
        result.errors.push(`spotify.fields[${i}].${key} '${field[key]}' must be album`);
      }
    });
  });

  if (_.some(config.tags, tag => _.has(tag, 'tableOrder'))) {
    result.errors.push(
      'tags[].tableOrder is no longer supported (column order is set by views.<format>.tags)'
    );
  }

  return result;
}

/**
 * Validates library.tags and views of the merged config, returns errors.
 * `missingTags` are library.tags names not found in the user tags or tags.json.
 */
// filter terms the way the cli splits a configured filter: before each field:, a value may hold spaces
const filterTerms = filter => `${filter}`.trim().split(/\s+(?=~?[\w]+:)/);

/**
 * What is wrong with the terms of a filter (field:value, ~field:value, or a rating number): terms that
 * are none of these, and fields that are not rating or a library tag (fieldNames). The cli ignores such
 * terms, so a typo would match every song (a push would add the whole library to a playlist).
 */
const filterProblems = (terms, fieldNames) =>
  _.compact(
    _.map(_.compact(terms), term => {
      if (/^\d+(?:\.\d+)?$/.test(term)) {
        return null;
      }
      const match = /^~?([\w-]+):/.exec(term);
      if (!match) {
        return `'${term}' is not field:value`;
      }
      return match[1] === 'rating' || fieldNames.has(match[1])
        ? null
        : `unknown field '${match[1]}' in '${term}'`;
    })
  );

function validateLibrary(config, missingTags = []) {
  const errors = _.map(
    missingTags,
    name => `Tag '${name}' defined in library.tags but not found in user tags or global tags.json`
  );
  const libraryTags = _.get(config, 'library.tags', []);

  // Library tags are read and written as strings, so only text and custom text frames are supported
  const isTextFrame = id => /^T(?!XXX$)[A-Z0-9]{3}$/.test(id) || /^TXXX\..+/.test(id);
  _.each(libraryTags, ({ name, id }) => {
    if (!isTextFrame(id)) {
      errors.push(
        `Tag '${name}' in library.tags uses frame '${id}', only text (T***) and custom (TXXX.*) frames are supported`
      );
    }
  });

  // Each frame can only map to one tag name
  _.each(_.groupBy(libraryTags, 'id'), (tags, id) => {
    if (tags.length > 1) {
      errors.push(`Tags '${_.map(tags, 'name').join("', '")}' in library.tags share frame '${id}'`);
    }
  });

  // configured filters may only use known fields: a typo would match every song
  const fieldNames = new Set(_.map(libraryTags, 'name'));
  _.each(
    [
      ['stats.filters', _.get(config, 'stats.filters', [])],
      ['sync.playlists', _.get(config, 'sync.playlists', [])],
      ['menu.buttons', _.get(config, 'menu.buttons', [])]
    ],
    ([key, entries]) =>
      _.each(entries, (entry, i) => {
        if (_.isPlainObject(entry) && _.isString(entry.filter)) {
          _.each(filterProblems(filterTerms(entry.filter), fieldNames), problem =>
            errors.push(`${key}[${i}].filter: ${problem}`)
          );
        }
      })
  );

  // Spotify fallbacks fill standard tags, custom fields are written by the mapping itself
  const knownTags = _.uniqBy((config.tags || []).concat(globalTags), 'name');
  _.each(_.get(config, 'spotify.fields', []), ({ name, fallback }) => {
    if (!fallback) {
      return;
    }
    const tag = _.find(knownTags, { name: fallback });
    if (!tag) {
      errors.push(
        `Fallback '${fallback}' of Spotify field '${name}' is not a tag in tags or tags.json`
      );
    } else if (/^TXXX\./.test(tag.id)) {
      errors.push(
        `Fallback '${fallback}' of Spotify field '${name}' must be a standard tag, not ${tag.id}`
      );
    }
  });

  // Views can only display library tags, plus rating which is configured separately
  const viewableTags = ['rating'].concat(_.map(libraryTags, 'name'));
  _.each(config.views, (view, viewName) => {
    _.each(view.tags, ({ name }) => {
      if (!viewableTags.includes(name)) {
        errors.push(
          `Tag '${name}' defined in views.${viewName}.tags but not found in library.tags`
        );
      }
    });
  });

  return errors;
}

/**
 * Gets the user config file path
 */
function getUserConfigPath() {
  return path.join(os.homedir(), '.musicmanrc.yml');
}

/**
 * Ensures user config file exists, copying from default if needed
 */
function ensureUserConfig(userConfigPath = getUserConfigPath()) {
  const defaultConfigPath = path.join(__dirname, 'defaultConfig.yml');

  if (!fs.existsSync(userConfigPath)) {
    fs.copyFileSync(defaultConfigPath, userConfigPath);
    console.log(`Created user config file at ${userConfigPath}`);
    console.log('Please review and customize your configuration settings.');
  }
}

/**
 * Reads the user config file, returns an empty config if it does not exist
 */
function readUserConfig(userConfigPath = getUserConfigPath()) {
  if (!fs.existsSync(userConfigPath)) {
    return {};
  }
  try {
    return yaml.load(fs.readFileSync(userConfigPath, 'utf8')) || {};
  } catch (error) {
    throw new Error(`Failed to parse user config file ${userConfigPath}: ${error.message}`, {
      cause: error
    });
  }
}

module.exports = {
  filterProblems,
  filterTerms,
  logLevels,
  parseInterval,
  parsePlaylistId,
  validateConfig,
  validateLibrary,
  readUserConfig,
  ensureUserConfig,
  getUserConfigPath,
  configSchema
};
