const { setupApp, getRequest } = require('./utils');

describe('e2e Route Tests', async () => {
  const startTime = new Date().getTime();

  let app;
  before(async function() {
    this.timeout(10000);
    app = await setupApp();
  });

  it('Should return version number', async () => {
    const res = await getRequest(app, '/version');
    expect(res.body.version).to.be.ok;
    expect(res.statusCode).to.equal(200);
  });

  it('Should return scan directory', async () => {
    const res = await getRequest(app, '/scan');
    expect(res.statusCode).to.equal(200);
  });

  after(() =>
    console.log(`\n    Finished testing in ${new Date().getTime() - startTime}ms (${new Date().toLocaleTimeString()})`)
  );
});
