const _ = require('lodash');
const Confirm = require('prompt-confirm');

const { getFilteredFiles, assignMetadata, saveMetadata } = require('./common.cjs');
const { outputDifferences } = require('../output/index.cjs');
const { checkExists } = require('../utils/files.cjs');
const logger = require('../utils/logger.cjs');

const isTest = process.env.NODE_ENV === 'test';

const editCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { assignments } = options;

  const filtered = await getFilteredFiles({ target, options, config });

  const prompt = new Confirm({
    message: `You are about to apply changes to ${filtered.length} files, proceed?`
  });

  if (filtered.length > 1 && !isTest) {
    const verifyEdit = await prompt.run();
    if (!verifyEdit) {
      logger.info(`Declined to modify ${filtered.length} files`);
      return false;
    }
  }

  // TODO: handle this better
  if (filtered.length === 0) {
    return false;
  }

  // assign new metadata fields, map to Id3 tag names and save
  const newFilesMetadata = _.map(filtered, assignMetadata(assignments));

  // transform to id3 tags and write to files
  saveMetadata(newFilesMetadata, config);

  // load new metadata for comparison
  const savedMetadata = await getFilteredFiles({ options: {}, config }, _.unzip(filtered)[0]);
  outputDifferences(_.unzip(filtered)[1], _.unzip(savedMetadata)[1]);

  logger.info(`${filtered.length} files updated`);

  return { oldFiles: filtered, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
