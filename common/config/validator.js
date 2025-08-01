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
      padding: { type: 'number', min: 0, required: false },
      table: {
        type: 'object',
        properties: {
          color: { type: 'string', required: false },
          headers: { type: 'object', required: false },
          seperators: { type: 'object', required: false }
        },
        required: false
      },
      vertical: {
        type: 'object',
        properties: {
          color: { type: 'string', required: false },
          headers: { type: 'object', required: false }
        },
        required: false
      }
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
      default: { type: 'array', required: false },
      edit: { type: 'array', required: false },
      playlist: { type: 'array', required: false },
      stats: { type: 'array', required: false }
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

/**
 * Validates a value against a schema definition
 */
function validateValue(value, schema, path = '') {
  const errors = [];

  if (schema.required && (value === undefined || value === null)) {
    errors.push(`${path} is required`);
    return errors;
  }

  if (value === undefined || value === null) {
    return errors;
  }

  // Type validation
  if (schema.type === 'string' && typeof value !== 'string') {
    errors.push(`${path} must be a string`);
  } else if (schema.type === 'number' && typeof value !== 'number') {
    errors.push(`${path} must be a number`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean`);
  } else if (schema.type === 'array' && !Array.isArray(value)) {
    errors.push(`${path} must be an array`);
  } else if (schema.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
    errors.push(`${path} must be an object`);
  }

  // Range validation for numbers
  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.min !== undefined && value < schema.min) {
      errors.push(`${path} must be >= ${schema.min}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      errors.push(`${path} must be <= ${schema.max}`);
    }
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
  }

  // Object property validation
  if (schema.type === 'object' && schema.properties && typeof value === 'object') {
    Object.keys(value).forEach(key => {
      if (!schema.properties[key]) {
        errors.push(`${path}.${key} is not a valid configuration option`);
      } else {
        const nestedErrors = validateValue(value[key], schema.properties[key], `${path}.${key}`);
        errors.push(...nestedErrors);
      }
    });
  }

  return errors;
}

/**
 * Validates the entire config object
 */
function validateConfig(config) {
  const errors = [];

  Object.keys(config).forEach(key => {
    if (!configSchema[key]) {
      errors.push(`${key} is not a valid configuration option`);
    } else {
      const fieldErrors = validateValue(config[key], configSchema[key], key);
      errors.push(...fieldErrors);
    }
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
function ensureUserConfig() {
  const userConfigPath = getUserConfigPath();
  const defaultConfigPath = path.join(__dirname, 'defaultConfig.yml');

  if (!fs.existsSync(userConfigPath)) {
    try {
      fs.copyFileSync(defaultConfigPath, userConfigPath);
      console.log(`Created user config file at ${userConfigPath}`);
      console.log('Please review and customize your configuration settings.');
    } catch (error) {
      console.error(`Failed to create user config file: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Validates user config file
 */
function validateUserConfig() {
  const userConfigPath = getUserConfigPath();

  if (!fs.existsSync(userConfigPath)) {
    return [];
  }

  try {
    const userConfigContent = fs.readFileSync(userConfigPath, 'utf8');
    const userConfig = yaml.load(userConfigContent);
    
    const errors = validateConfig(userConfig);
    
    if (errors.length > 0) {
      console.warn('Configuration validation issues found:');
      errors.forEach(error => console.warn(`  - ${error}`));
    }
    
    return errors;
  } catch (error) {
    console.error(`Failed to parse user config file: ${error.message}`);
    throw error;
  }
}

/**
 * Performs config initialization and validation
 */
function initializeConfig() {
  // Ensure user config exists
  ensureUserConfig();
  
  // Validate user config
  const validationErrors = validateUserConfig();
  
  if (validationErrors.length > 0) {
    console.warn(`Found ${validationErrors.length} configuration validation issues`);
    console.warn('Please check your ~/.musicmanrc.yml file');
  }
  
  return validationErrors;
}

module.exports = {
  validateConfig,
  validateUserConfig,
  ensureUserConfig,
  getUserConfigPath,
  initializeConfig,
  configSchema
};