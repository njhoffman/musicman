const path = require('path');

const parserTests = require('./unit/parser');
const viewTests = require('./unit/view');
const editTests = require('./unit/edit');
const playlistTests = require('./unit/playlist');

const { resetSandbox } = require('./utils');

describe('Music Rater Tests', () => {
  let startTime;
  before(function() {
    this.timeout(10000);
    startTime = new Date().getTime();
    resetSandbox();
  });

  parserTests();
  viewTests();
  editTests();
  playlistTests();

  after(() => console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
