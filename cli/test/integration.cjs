const { resetSandbox, assignTestTags } = require('./utils.cjs');

describe('Integration Tests', async () => {
  const logTime = false;
  let startTime;
  before(async function() {
    this.timeout(10000);
    startTime = new Date().getTime();
    await assignTestTags();
    resetSandbox();
  });

  /* eslint-disable global-require */
  require('./integration/commands/view.cjs');
  require('./integration/commands/edit.cjs');
  require('./integration/commands/playlist.cjs');
  require('./integration/commands/stats.cjs');
  /* eslint-enable global-require */

  after(() => logTime && console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
