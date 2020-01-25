const _ = require('lodash');

const { getFilteredFiles, parseFileMetadata } = require('./common');
const { saveMetadata } = require('../utils/metadata');
const { checkExists } = require('../utils/files');
const logger = require('../utils/logger');

const editCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { assignments } = options;

  const filtered = await getFilteredFiles({ target, options, config });

  // assign new metadata fields, map to Id3 tag names and save
  const newFilesMetadata = _.map(filtered, ([file, meta]) => [file, { ...meta, ...assignments }]);

  saveMetadata(newFilesMetadata, config);

  // load new metadata for comparison
  const savedMetadata = await parseFileMetadata(_.unzip(filtered)[0], config);
  logger.outputDifferences(filtered, savedMetadata);

  return { oldFiles: filtered, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
