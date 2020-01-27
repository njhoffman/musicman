const _ = require('lodash');

const { getFilteredFiles, assignMetadata, saveMetadata } = require('./common');
const { outputDifferences } = require('../output');
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
  const newFilesMetadata = _.map(filtered, assignMetadata(assignments));

  // transform to id3 tags and write to files
  saveMetadata(newFilesMetadata, config);

  logger.info(`${filtered.length} files updated`);

  // load new metadata for comparison
  const savedMetadata = await getFilteredFiles({ options: {}, config }, _.unzip(filtered)[0]);
  outputDifferences(_.unzip(filtered)[1], _.unzip(savedMetadata)[1]);

  return { oldFiles: filtered, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
