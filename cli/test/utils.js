const path = require('path');
const rimraf = require('rimraf');
const copyDir = require('copy-dir');

const sourceDir = path.join(process.cwd(), 'test/data/source');
const destinationDir = path.join(process.cwd(), 'test/data/sandbox');

const resetSandbox = () => {
  rimraf.sync(`${destinationDir}/**/*`);
  copyDir.sync(sourceDir, destinationDir);
};

module.exports = { resetSandbox };
