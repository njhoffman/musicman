const _ = require('lodash');
const logger = require('../utils/logger');

const viewCommand = async ({ target, options, config, utils }) => {
  const {
    file: { checkExists, getFiles, filterFiles },
    metadata: { getMetadata, parseFileMetadata }
  } = utils;

  const exists = checkExists(target);

  if (!exists) {
    console.log('EXISTS', exists);
    throw new Error(`Target does not exist: ${target}`);
  }

  const { recursive = config.recursive, exclude = [], include = [] } = options.switches;

  const files = exists.isDirectory() ? getFiles(target, { ext: 'mp3', recursive }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);
  const cleanedMetadata = _.map(parsedMetadata, ([file, meta]) =>
    include.length > 0 ? [file, _.pick(meta, include)] : [file, _.omit(meta, exclude)]
  );
  const metadata = cleanedMetadata.filter(filterFiles(options.filters)).map(([file, meta]) => meta);

  const format = metadata.length === 1 ? 'vertical' : 'table';

  return logger.outputMetadata({ target, metadata, config, format });
};

module.exports = { name: 'view', func: viewCommand };
