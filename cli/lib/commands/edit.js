const _ = require('lodash');
const NodeId3 = require('node-id3');

const logger = require('../utils/logger');

const parseOptions = (options, config) => {
  const optionFields = {
    recursive: config.recursive
  };

  options.forEach((option, i) => {
    if (option === '-r') {
      optionFields.recursive = true;
    } else if (option === '-nr') {
      optionFields.recursive = false;
    }
  });
  return optionFields;
};

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

  const optionList = options.split(' ');
  const { recursive } = parseOptions(optionList, config);

  const files = exists.isDirectory() ? await getFiles(target, { ext: 'mp3', recursive }) : target;
  const filesMetadata = parseFileMetadata(await getMetadata(files));
  const newFilesMetadata = _.map(filesMetadata, processFields(optionList));
  const newFilesId3Tags = _.map(newFilesMetadata, newFile => prepareId3Tags(newFile));

  newFilesId3Tags.forEach(([file, id3tags]) => NodeId3.update(id3tags, file));

  // load new metadata for comparison
  const savedMetadata = parseFileMetadata(await getMetadata(files));
  logger.outputDifferences(filesMetadata, savedMetadata);

  return { oldFiles: filesMetadata, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
