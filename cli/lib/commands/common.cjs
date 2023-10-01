const _ = require('lodash');

const logger = require('../utils/logger.cjs');
const { getFiles } = require('../utils/files.cjs');
const {
  getMetadata,
  getMetadataFull,
  parseMetadata,
  writeFiles,
  filterFiles,
  mergeAssignments
} = require('../metadata.cjs');

const saveMetadata = (files, config) => _.map([files], writeFiles(config));

const assignMetadata =
  assignments =>
    ([file, meta]) =>
      [file, mergeAssignments(meta, assignments)];

const parseFileMetadata = (filesMetadata, config) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, config)]);

const getFilteredFiles = async (
  { target, options = {}, config = {}, fullMetadata = false },
  fileList
) => {
  const { switches: { recursive = config.recursive } = {}, filters } = options;

  const files = fileList || getFiles(target, { ext: 'mp3', recursive });

  // logger.debug(`Getting metadata for ${files.length} files`);
  // TODO: fix memory overflow in event loop

  const metadataFiles = fullMetadata ? await getMetadataFull(files) : await getMetadata(files);

  // logger.debug(`Parsing metadata for ${metadataFiles.length} files`);
  const parsedFiles = parseFileMetadata(metadataFiles, config);
  return filters ? _.filter(parsedFiles, filterFiles(filters)) : parsedFiles;
};

module.exports = { getFilteredFiles, parseFileMetadata, saveMetadata, assignMetadata };
