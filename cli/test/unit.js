const path = require('path');
const rimraf = require('rimraf');
const copyDir = require('copy-dir');

const parserTests = require('./unit/parser');
const viewTests = require('./unit/view');
const editTests = require('./unit/edit');
const playlistTests = require('./unit/playlist');

const sourceDir = path.join(process.cwd(), 'test/data/source');
const destinationDir = path.join(process.cwd(), 'test/data/sandbox');

describe('Music Rater Tests', () => {
  let startTime;
  before(function() {
    this.timeout(10000);
    startTime = new Date().getTime();
    rimraf.sync(`${destinationDir}/**/*`);
    copyDir.sync(sourceDir, destinationDir);
  });

  parserTests();
  viewTests();
  editTests();
  // playlistTests();

  after(() => console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
