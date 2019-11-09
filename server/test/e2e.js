const { setupApp, getRequest } = require('./utils');

describe('e2e Route Tests', async () => {
  let app;
  before(async function() {
    this.timeout(10000);
    app = await setupApp();
  });

  it('Should be a true first test', async () => {
    console.log("APP", app);
    expect(true).to.equal(true);
  });
  it('Should return version number', async () => {
    const res = await getRequest(app, '/version');
    expect(res.body.version).to.be.ok;
    expect(res.statusCode).to.equal(200);
  });
});
