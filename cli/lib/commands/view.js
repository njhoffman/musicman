const _ = require('lodash');
const columnify = require('columnify');
const { checkExists, getFiles, getMetadata, parseFileMetadata } = require('../utils');
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

const viewCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  const files = exists.isDirectory() ? getFiles(target, { ext: 'mp3', recursive: true }) : target;

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);
  const metadata = _.map(parsedMetadata, ([file, meta]) => meta);

  const format = metadata.length === 1 ? 'vertical' : 'table';
  return outputMetadata({ target, metadata, config, format });
};

module.exports = { name: 'view', func: viewCommand };
