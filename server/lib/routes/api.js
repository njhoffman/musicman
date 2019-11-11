const Router = require('express-promise-router');

const config = require('@config');

const router = new Router();

router.get('/version', (req, res) => {
  res.send({ version: config.version });
});

module.exports = router;
