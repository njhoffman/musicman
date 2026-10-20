const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');

// Use console for logging since common doesn't have logger

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
      backupInterval: { type: 'string', required: false },
      backupCount: { type: 'number', min: 1, required: false }
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
      verbosity: { type: 'number', min: 1, max: 6, required: false },
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
      tagId: { type: 'string', required: false },
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
          seperators: { type: 'object', required: false },
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
  websocket: {
    type: 'object',
    properties: {
      port: { type: 'number', min: 1, max: 65535, required: false }
    }
  },
  server: {
    type: 'object',
    properties: {
      port: { type: 'number', min: 1, max: 65535, required: false }
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
              gui: { type: 'string', enum: ['normal', 'bold', 'italic', 'underline'], required: false }
            },
            required: false
          },
          error: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: { type: 'string', enum: ['normal', 'bold', 'italic', 'underline'], required: false }
            },
            required: false
          },
          warn: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: { type: 'string', enum: ['normal', 'bold', 'italic', 'underline'], required: false }
            },
            required: false
          },
          log: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: { type: 'string', enum: ['normal', 'bold', 'italic', 'underline'], required: false }
            },
            required: false
          },
          info: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: { type: 'string', enum: ['normal', 'bold', 'italic', 'underline'], required: false }
            },
            required: false
          },
          debug: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: { type: 'string', enum: ['normal', 'bold', 'italic', 'underline'], required: false }
            },
            required: false
          },
          trace: {
            type: 'object',
            properties: {
              fg: { type: 'string', required: false },
              bg: { type: 'string', required: false },
              gui: { type: 'string', enum: ['normal', 'bold', 'italic', 'underline'], required: false }
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
          level: { type: 'number', min: 0, max: 6, required: false }
        },
        required: false
      },
      stdout: {
        type: 'object',
        properties: {
          level: { type: 'number', min: 0, max: 6, required: false }
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

// options moved into views, reported as errors with where they moved to
const legacyOptions = {
  'output.table': 'moved to views.table',
  'output.vertical': 'moved to views.list'
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

  // Type validation
  if (schema.type === 'string' && typeof value !== 'string') {
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

  if (_.some(config.tags, tag => _.has(tag, 'tableOrder'))) {
    result.errors.push('tags[].tableOrder is no longer supported (column order is set by views.<format>.tags)');
  }

  return result;
}

/**
 * Validates library.tags and views of the merged config, returns errors.
 * `missingTags` are library.tags names not found in the user tags or tags.json.
 */
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

  // Views can only display library tags, plus rating which is configured separately
  const viewableTags = ['rating'].concat(_.map(libraryTags, 'name'));
  _.each(config.views, (view, viewName) => {
    _.each(view.tags, ({ name }) => {
      if (!viewableTags.includes(name)) {
        errors.push(`Tag '${name}' defined in views.${viewName}.tags but not found in library.tags`);
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
    throw new Error(`Failed to parse user config file ${userConfigPath}: ${error.message}`);
  }
}

module.exports = {
  parseInterval,
  validateConfig,
  validateLibrary,
  readUserConfig,
  ensureUserConfig,
  getUserConfigPath,
  configSchema
};
