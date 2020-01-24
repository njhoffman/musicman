const _ = require('lodash');
const logger = require('../utils/logger');
const { checkExists, getFiles, filterFiles } = require('../utils/files');
const { getMetadata, parseFileMetadata } = require('../utils/metadata');

const viewCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { recursive = config.recursive, exclude = [], include = [] } = options.switches;

  const files = exists.isDirectory() ? getFiles(target, { ext: 'mp3', recursive }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles, config);

  // filter files, include/exclude metadata fields defined by switches
  const metadata = _.chain(parsedMetadata)
    .filter(filterFiles(options.filters))
    .map(([file, meta]) => (include.length > 0 ? _.pick(meta, include) : _.omit(meta, exclude)))
    .value();

  const format = metadata.length === 1 ? 'vertical' : 'table';

  return logger.outputMetadata({ target, metadata, config, format, options });
};

module.exports = { name: 'view', func: viewCommand };
