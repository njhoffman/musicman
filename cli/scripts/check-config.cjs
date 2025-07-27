#!/usr/bin/env node

const { validateUserConfig, getUserConfigPath } = require('musicman-common/config/validator');

console.log('Checking musicman configuration...');

try {
  const errors = validateUserConfig();
  const configPath = getUserConfigPath();
  
  if (errors.length === 0) {
    console.log('✓ Configuration is valid');
    console.log(`Config file: ${configPath}`);
  } else {
    console.log(`✗ Found ${errors.length} configuration issues:`);
    errors.forEach(error => console.log(`  - ${error}`));
    console.log(`Config file: ${configPath}`);
    process.exit(1);
  }
} catch (error) {
  console.error('✗ Configuration check failed:', error.message);
  process.exit(1);
}