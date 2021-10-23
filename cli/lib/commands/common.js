const _ = require('lodash');

const logger = require('../utils/logger');
const { getFiles } = require('../utils/files');
const {
  getMetadata,
  parseMetadata,
  writeFiles,
  filterFiles,
  mergeAssignments
} = require('../metadata');

const saveMetadata = (files, config) => _.map([files], writeFiles(config));

const assignMetadata = assignments => ([file, meta]) => [file, mergeAssignments(meta, assignments)];

const parseFileMetadata = (filesMetadata, config) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, config)]);

const getFilteredFiles = async ({ target, options = {}, config = {} }, fileList) => {
  const { switches: { recursive = config.recursive } = {}, filters } = options;

  const files = fileList || getFiles(target, { ext: 'mp3', recursive });

  // logger.debug(`Getting metadata for ${files.length} files`);
  // TODO: fix memory overflow in event loop

  const metadataFiles = await getMetadata(files);
  // logger.debug(`Parsing metadata for ${metadataFiles.length} files`);
  const parsedFiles = parseFileMetadata(metadataFiles, config);
  return filters ? _.filter(parsedFiles, filterFiles(filters)) : parsedFiles;
};

module.exports = { getFilteredFiles, parseFileMetadata, saveMetadata, assignMetadata };
