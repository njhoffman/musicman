const fileUtils = require('./files');
const metadataUtils = require('./metadata');
const tagUtils = require('./tags');

module.exports = config => ({
  file: fileUtils(config),
  metadata: metadataUtils(config),
  tags: tagUtils(config)
});
