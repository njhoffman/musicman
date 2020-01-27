const { resetSandbox, assignTestTags } = require('./utils');

describe('Music Rater Tests', async () => {
  const logTime = false;
  let startTime;
  before(async function() {
    this.timeout(10000);
    startTime = new Date().getTime();
    await assignTestTags();
    resetSandbox();
  });

  /* eslint-disable global-require */
  require('./unit/parser/target');
  require('./unit/parser/command');
  require('./unit/parser/options');

  require('./unit/filter');
  require('./unit/commands/view');
  require('./unit/commands/edit');
  require('./unit/commands/playlist');
  /* eslint-enable global-require */

  after(() => logTime && console.log(`\n    Finished in ${new Date().getTime() - startTime}ms.`));
});
