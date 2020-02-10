const Router = require('express-promise-router');

const config = require('../../config');

const router = new Router();

module.exports = modules => {
  router.get('/version', (req, res) => {
    res.send({ version: config.version });
  });
  return router;
};
