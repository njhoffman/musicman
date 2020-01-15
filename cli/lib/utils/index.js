const fileUtils = require('./files');
const metadataUtils = require('./metadata');

module.exports = config => ({
  file: fileUtils(config),
  metadata: metadataUtils(config)
});
