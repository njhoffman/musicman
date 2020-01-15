const _ = require('lodash');
const columnify = require('columnify');
const logger = require('../utils/logger');

const outputMetadata = ({ metadata, target, config, format }) => {
  let output = '';
  if (metadata.length === 0) {
    output = `\nNo mp3 files found in ${target}`;
  } else if (format === 'vertical') {
    output = metadata.map(mItem => _.pick(mItem, _.map(config.tags, 'name')));
    output = metadata.length === 1 ? output[0] : output;
  } else {
    const columns = ['rating'].concat(
      _.chain(config.tags)
        .filter('viewIndex')
        .sortBy('viewIndex')
        .map('name')
        .value()
    );
    output = columnify(metadata, { columns, maxLineWidth: 'auto' });
  }
  return logger.info(output);
};

const viewCommand = async ({ target, options = '', config, utils }) => {
  const {
    file: { checkExists, getFiles },
    metadata: { getMetadata, parseFileMetadata }
  } = utils;

  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const optionList = options.split(' ');
  const optionFields = {
    recursive: config.recursive,
    included: [],
    excluded: []
  };

  optionList.forEach((option, i) => {
    if (option == '-r') {
      optionFields.recursive = true;
    } else if (option === '-nr') {
      optionFields.recursive = false;
    } else if (option === '-x') {
      optionFields.excluded = optionList[i + 1];
    } else if (option === '-i') {
      optionFields.included = optionList[i + 1];
    }
  });

  const { recursive, included, excluded } = optionFields;
  const files = exists.isDirectory() ? getFiles(target, { ext: 'mp3', recursive }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);

  // omit or exclusively include keys from -x and -i command line switches
  const metadata = _.map(parsedMetadata, ([file, meta]) => {
    return included.length > 0 ? _.pick(meta, included) : _.omit(meta, excluded);
  });

  const format = metadata.length === 1 ? 'vertical' : 'table';
  return outputMetadata({ target, metadata, config, format });
};

module.exports = { name: 'view', func: viewCommand };
