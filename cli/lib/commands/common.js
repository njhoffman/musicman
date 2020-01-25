const _ = require('lodash');

const { getFiles, filterFiles } = require('../utils/files');
const { getMetadata, parseMetadata } = require('../utils/metadata');

const parseFileMetadata = (filesMetadata, config) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, config)]);

const getFilteredFiles = async ({ target, options = {}, config = {} }, fileList) => {
  const { switches: { recursive = config.recursive } = {}, filters } = options;

  const files = fileList || getFiles(target, { ext: 'mp3', recursive });

  const metadataFiles = await getMetadata(files);
  const parsedFiles = parseFileMetadata(metadataFiles, config);
  return filters ? _.filter(parsedFiles, filterFiles(filters)) : parsedFiles;
};

module.exports = { getFilteredFiles, parseFileMetadata };
