const _ = require('lodash');

const { getFiles, filterFiles } = require('../utils/files');
const { getMetadata, parseMetadata } = require('../utils/metadata');

const parseFileMetadata = (filesMetadata, config) =>
  _.map(filesMetadata, ([file, metadata]) => [file, parseMetadata(metadata, config)]);

const getFilteredFiles = async ({ target, options, config }) => {
  const { recursive = config.recursive } = options.switches;

  const files = getFiles(target, { ext: 'mp3', recursive });

  const metadataFiles = await getMetadata(files);
  return parseFileMetadata(metadataFiles, config).filter(filterFiles(options.filters));
};

module.exports = { getFilteredFiles, parseFileMetadata };
