const _ = require('lodash');
const logger = require('../utils/logger');

const parseOptions = (options, config) => {
  const optionFields = {
    included: [],
    excluded: [],
    recursive: config.recursive
  };

  options.forEach((option, i) => {
    if (option === '-r') {
      optionFields.recursive = true;
    } else if (option === '-nr') {
      optionFields.recursive = false;
    } else if (option === '-x') {
      optionFields.excluded = options[i + 1];
    } else if (option === '-i') {
      optionFields.included = options[i + 1];
    }
  });
  return optionFields;
};

const viewCommand = async ({ target, options = '', config, utils }) => {
  const {
    file: { checkExists, getFiles },
    metadata: { getMetadata, parseFileMetadata }
  } = utils;

  const exists = checkExists(target);
  if (!exists) {
    console.log('EXISTS', exists);
    throw new Error(`Target does not exist: ${target}`);
  }

  const optionList = options.split(' ');
  const { recursive, excluded, included } = parseOptions(optionList, config);

  const files = exists.isDirectory() ? getFiles(target, { ext: 'mp3', recursive }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);

  // omit or exclusively include keys from -x and -i command line switches
  const metadata = _.map(parsedMetadata, ([file, meta]) => {
    return included.length > 0 ? _.pick(meta, included) : _.omit(meta, excluded);
  });

  const format = metadata.length === 1 ? 'vertical' : 'table';
  return logger.outputMetadata({ target, metadata, config, format });
};

module.exports = { name: 'view', func: viewCommand };
