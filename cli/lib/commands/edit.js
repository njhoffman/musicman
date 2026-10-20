const _ = require('lodash');
const Confirm = require('prompt-confirm');

const {
  getFilteredFiles,
  assignMetadata,
  saveMetadata,
  updateLibraryFiles
} = require('./common.js');
const { outputDifferences } = require('../output/index.js');
const { checkExists } = require('../utils/files.js');
const logger = require('../utils/logger.js');

const isTest = process.env.NODE_ENV === 'test';

const editCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { assignments } = options;

  const filtered = await getFilteredFiles({ target, options, config });

  if (filtered.length === 0) {
    logger.info('No files matched, nothing to edit');
    return false;
  }

  // editing several files at once asks first
  if (filtered.length > 1 && !isTest) {
    const prompt = new Confirm({
      message: `You are about to apply changes to ${filtered.length} files, proceed?`
    });
    if (!(await prompt.run())) {
      logger.info(`Declined to modify ${filtered.length} files`);
      return false;
    }
  }

  // assign new metadata fields, map to Id3 tag names and save
  const newFilesMetadata = _.map(filtered, assignMetadata(assignments));

  // transform to id3 tags and write to files
  saveMetadata(newFilesMetadata, config);

  // load new metadata for comparison
  const savedMetadata = await getFilteredFiles({ options: {}, config }, _.unzip(filtered)[0]);
  outputDifferences(_.unzip(filtered)[1], _.unzip(savedMetadata)[1]);

  // keep the library database in step with the files that were written
  await updateLibraryFiles({ files: _.unzip(filtered)[0], options, config });

  logger.info(`${filtered.length} files updated`);

  return { oldFiles: filtered, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
