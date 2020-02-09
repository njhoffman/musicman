const { resetSandbox, assignTestTags } = require('./utils');

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
  require('./integration/commands/view');
  require('./integration/commands/edit');
  require('./integration/commands/playlist');
  require('./integration/commands/stats');
  /* eslint-enable global-require */

  after(() => logTime && console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
