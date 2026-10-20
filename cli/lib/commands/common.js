const _ = require('lodash');

const logger = require('../utils/logger.js');
const { getFiles } = require('../utils/files.js');
const {
  getMetadata,
  getMetadataFull,
  parseMetadata,
  writeFiles,
  filterFiles,
  mergeAssignments
} = require('../metadata.js');

const saveMetadata = (files, config) => _.map([files], writeFiles(config));

const assignMetadata =
  assignments =>
  ([file, meta]) =>
    [file, mergeAssignments(meta, assignments)];

// [file, parsed metadata], with raw id3 frames appended as a third element when withRaw is set
const parseFileMetadata = (filesMetadata, config, withRaw = false) =>
  _.map(filesMetadata, ([file, metadata]) =>
    withRaw
      ? [file, parseMetadata(metadata, config), metadata]
      : [file, parseMetadata(metadata, config)]
  );

const getFilteredFiles = async (
  { target, options = {}, config = {}, fullMetadata = false, withRaw = false },
  fileList
) => {
  const { switches: { recursive = config.recursive } = {}, filters } = options;

  const files = fileList || getFiles(target, { ext: 'mp3', recursive });

  // logger.debug(`Getting metadata for ${files.length} files`);
  // TODO: fix memory overflow in event loop

  const metadataFiles = fullMetadata ? await getMetadataFull(files) : await getMetadata(files);

  // logger.debug(`Parsing metadata for ${metadataFiles.length} files`);
  const parsedFiles = parseFileMetadata(metadataFiles, config, withRaw);
  return filters ? _.filter(parsedFiles, filterFiles(filters)) : parsedFiles;
};

module.exports = { getFilteredFiles, parseFileMetadata, saveMetadata, assignMetadata };
