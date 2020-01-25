const _ = require('lodash');
const { checkExists, getFiles, filterFiles } = require('../utils/files');
const { getMetadata, parseFileMetadata, saveMetadata } = require('../utils/metadata');

const logger = require('../utils/logger');

const editCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { recursive = config.recursive } = options.switches;

  const files = exists.isDirectory() ? getFiles(target, { ext: 'mp3', recursive }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles, config).filter(filterFiles(options.filters));

  // assign new metadata fields, map to Id3 tag names and save
  const newFilesMetadata = _.map(parsedMetadata, ([file, meta]) => {
    return [file, { ...meta, ...options.assignments }];
  });

  saveMetadata(newFilesMetadata);

  // load new metadata for comparison
  const savedMetadata = parseFileMetadata(await getMetadata(files), config);
  logger.outputDifferences(parsedMetadata, savedMetadata);

  return { oldFiles: metadataFiles, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
