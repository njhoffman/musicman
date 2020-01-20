const fs = require('fs');
const path = require('path');

const testDir = 'test/tmp/';

// Add each .js file to the mocha instance
const files = fs
  .readdirSync(testDir)
  .filter(file => {
    return file.substr(-3) === '.js';
  })
  .map(file => path.join(process.cwd(), testDir, file));

const describe = (desc, func) => {
  console.log('DESCRIBE', desc, func.toString());
};

const modules = files.map(file => {
  /* eslint-disable global-require, import/no-dynamic-require */
  global.describe = describe;
  return require(`${file}`);
  /* eslint-enable global-require, import/no-dynamic-require */
});

console.log('files ', files);
