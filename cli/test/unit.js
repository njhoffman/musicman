const path = require('path');

const { resetSandbox, assignTestTags } = require('./utils');

describe('Music Rater Tests', async () => {
  let startTime;
  before(async function() {
    this.timeout(10000);
    startTime = new Date().getTime();
    await assignTestTags();
    resetSandbox();
  });

  require('./unit/parser');
  require('./unit/view');
  require('./unit/edit');
  require('./unit/playlist');

  after(() => console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
