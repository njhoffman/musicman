const _ = require('lodash');
const path = require('path');
const router = require('express-promise-router')();
const { parseFile } = require('music-metadata');

const { routeError } = require('./utils/errors');
const config = require('../config');
const { crawlDirectory } = require('./utils');

const initRouter = (app) => {
  router.get('/version', (req, res) => {
    res.send({ version: config.version });
  });

  router.get('/scan', async (req, res) => {
    const { basePath } = config.library;
    const files = await crawlDirectory(basePath);
    const filePaths = files.map(file => path.join(basePath, file));

    // const fileLookups = filePaths.map(filePath => parseFile(filePath));
    const { tagId, tags } = config.library;
    const metadata = await Promise.all(
      filePaths.map(filePath =>
        parseFile(filePath, { native: true })
        .then(({ native }) => {
          const fields = native[tagId];
          if (!fields) {
            throw new Error(`Invalid Tag ID: ${_.keys(native)}`);
          }
          const taggedFields = _.reduce(tags, (acc, { id, name }) => {
            acc[name] = _.find(fields, { id }) ? _.find(fields, { id }).value : '';
            return acc;
          }, {});
          return { ...taggedFields, filePath };
        })
      )
    );
    res.send(metadata);
  });

  app.use(router);
  app.use(routeError);
  return app;
};

module.exports = initRouter;

