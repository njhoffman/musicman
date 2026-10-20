#!/usr/bin/env node

const { checkConfig } = require('musicman-common/config');
const { getUserConfigPath } = require('musicman-common/config/validator');

console.log('Checking musicman configuration...');

try {
  const { errors, warnings } = checkConfig();
  const configPath = getUserConfigPath();

  warnings.forEach(warning => console.log(`  warning: ${warning}`));
  errors.forEach(error => console.log(`  error: ${error}`));

  if (errors.length === 0) {
    console.log(
      `✓ Configuration is valid${warnings.length > 0 ? ` (${warnings.length} warnings)` : ''}`
    );
    console.log(`Config file: ${configPath}`);
  } else {
    console.log(`✗ Found ${errors.length} configuration errors`);
    console.log(`Config file: ${configPath}`);
    process.exit(1);
  }
} catch (error) {
  console.error('✗ Configuration check failed:', error.message);
  process.exit(1);
}
