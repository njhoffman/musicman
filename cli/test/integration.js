const { resetSandbox, assignTestTags } = require('./utils.js');

describe('Integration Tests', () => {
  const logTime = false;
  let startTime;
  before(async function() {
    this.timeout(10000);
    startTime = new Date().getTime();
    await assignTestTags();
    resetSandbox();
  });

  /* eslint-disable global-require */
  require('./unit/config.js');
  require('./integration/commands/view.js');
  require('./integration/commands/edit.js');
  require('./integration/commands/playlist.js');
  require('./integration/commands/stats.js');
  require('./integration/commands/db.js');
  /* eslint-enable global-require */

  after(() => logTime && console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
