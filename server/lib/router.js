const apiRoutes = require('./routes/api');
const metadataRoutes = require('./routes/metadata');
const { routeError } = require('./utils/errors');

module.exports = (app) => {
  app.use(apiRoutes);
  app.use(metadataRoutes);
  app.use(routeError);
  return app;
};

