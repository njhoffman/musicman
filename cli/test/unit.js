const path = require('path');

const parserTests = require('./unit/parser');
const viewTests = require('./unit/view');
const editTests = require('./unit/edit');
const playlistTests = require('./unit/playlist');

const { cleanDirectory } = require('./utils');

const sourceDir = path.join('test/data/sandbox', process.cwd());

describe('Unit tests', () => {
  let startTime;
  before(async function() {
    this.timeout(10000);
    startTime = new Date().getTime();
    await cleanDirectory(sourceDir);
  });

  // parserTests();
  // viewTests();
  editTests();
  // playlistTests();

  after(() => console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
