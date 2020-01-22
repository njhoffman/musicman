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

  /* eslint-disable global-require */
  require('./unit/parser');
  require('./unit/view');
  require('./unit/edit');
  // require('./unit/playlist');
  /* eslint-enable global-require */

  after(() => console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
