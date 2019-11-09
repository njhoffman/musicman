const { version } = require('../../package.json');

module.exports = {
  version,
  env: process.env.NODE_ENV,
  server: {
    port: 3000
  }
};
