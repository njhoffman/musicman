const { version } = require('../../package.json');

module.exports = {
  version,
  env: process.env.NODE_ENV,
  library: {
    basePath: '/home/nicholas/Music'
  },
  server: {
    port: 3000
  }
};
