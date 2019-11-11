const apiRoutes = require('./routes/api');
const metadataRoutes = require('./routes/metadata');
const mpdRoutes = require('./routes/mpd');
const { routeError } = require('./utils/errors');

module.exports = ({ app, ...modules }) => {
  app.use(apiRoutes(modules));
  app.use(metadataRoutes(modules));
  app.use(mpdRoutes(modules));
  app.use(routeError);
  return app;
};
