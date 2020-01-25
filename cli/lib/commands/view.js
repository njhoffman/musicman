const _ = require('lodash');
const { outputMetadata } = require('../utils/output');

const { getFilteredFiles } = require('./common');
const { checkExists } = require('../utils/files');

const viewCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { exclude = [], include = [] } = options.switches;

  const filtered = await getFilteredFiles({ target, options, config });

  // filter files, include/exclude metadata fields defined by switches
  const metadata = _.map(filtered, ([file, meta]) =>
    include.length > 0 ? _.pick(meta, include) : _.omit(meta, exclude)
  );

  const format = metadata.length === 1 ? 'vertical' : 'table';

  return outputMetadata({ target, metadata, config, format, options });
};

module.exports = { name: 'view', func: viewCommand };
