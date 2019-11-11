const apiRoutes = require('./routes/api');
const metadataRoutes = require('./routes/metadata');
const mpdRoutes = require('./routes/mpd');
const { routeError } = require('./utils/errors');

module.exports = app => {
  app.use(apiRoutes);
  app.use(metadataRoutes);
  app.use(mpdRoutes);
  app.use(routeError);
  return app;
};
