const path = require('path');
const rimraf = require('rimraf');
const copyDir = require('copy-dir');
const NodeId3 = require('node-id3');

const testTags = require('./data/testTags');

const sourceDir = path.join(process.cwd(), 'test/data/source');
const destinationDir = path.join(process.cwd(), 'test/data/sandbox');

const resetSandbox = () => {
  rimraf.sync(`${destinationDir}/**/*`);
  copyDir.sync(sourceDir, destinationDir);
};

const assignTestTags = async () => {
  // console.log(`Tagging ${testTags.length} test files`);
  testTags.map(([file, testTag]) => {
    const filePath = path.join(process.cwd(), 'test/data/source/', file);
    NodeId3.write(testTag, filePath);
    return [filePath, testTag];
  });
};

module.exports = { resetSandbox, assignTestTags };
