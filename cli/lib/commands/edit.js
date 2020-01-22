const _ = require('lodash');
const NodeId3 = require('node-id3');

const logger = require('../utils/logger');

const editCommand = async ({ target, options = '', config, utils }) => {
  const {
    file: { checkExists, getFiles },
    tags: { prepareId3Tags, processFields },
    metadata: { getMetadata, parseFileMetadata, writeMetadata }
  } = utils;

  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { recursive = config.recursive } = options.switches;

  const files = exists.isDirectory() ? getFiles(target, { ext: 'mp3', recursive }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);

  // assign new metadata fields, map to Id3 tag names and save
  const newFilesMetadata = _.map(parsedMetadata, ([file, meta]) => {
    return [file, { ...meta, ...options.assignments }];
  });

  const newFilesId3Tags = _.map(newFilesMetadata, newFile => prepareId3Tags(newFile));
  newFilesId3Tags.forEach(([file, id3tags]) => NodeId3.update(id3tags, file));

  // load new metadata for comparison
  const savedMetadata = parseFileMetadata(await getMetadata(files));
  logger.outputDifferences(parsedMetadata, savedMetadata);

  return { oldFiles: metadataFiles, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
