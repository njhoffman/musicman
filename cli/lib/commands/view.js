const _ = require('lodash');
const { outputMetadata } = require('../output/index.js');
const { emitFormatted, songColumns, songOneline, songRecords } = require('../output/emit.js');
const { outputFormat } = require('../output/formats.js');
const { previewCommand } = require('../output/fzf.js');
const { checkExists } = require('../utils/files.js');
const { getFilteredFiles, libraryScanOptions } = require('./common.js');

const viewCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { exclude = [], include = [] } = options.switches;

  const filtered = await getFilteredFiles({ target, options: libraryScanOptions(options), config });

  // filter files, include/exclude metadata fields defined by switches
  const metadata = _.map(filtered, ([file, meta]) =>
    include.length > 0 ? _.pick(meta, include) : _.omit(meta, exclude)
  );

  if (outputFormat(options.switches) !== 'default') {
    const columns = songColumns(config, options.switches);
    const { selected } = emitFormatted({
      switches: options.switches,
      config,
      title: `musicman view ${target}`,
      records: songRecords(filtered, columns),
      columns: ['path', ...columns],
      oneline: songOneline(config),
      preview: previewCommand('view')
    });
    return { metadata, selected };
  }

  const format = metadata.length === 1 ? 'list' : 'table';

  outputMetadata({ target, metadata, config, format, options });
  return { metadata };
};

module.exports = {
  name: 'view',
  description: 'Show tags of files: a table for several files, a list for one',
  usage: 'musicman [view] [target] [field:value ...]',
  switches: ['recursive', 'norecursive', 'include', 'exclude', 'files', 'format', 'fzf'],
  func: viewCommand,
  // without a target (and no song playing) the whole library is shown
  defaultTarget: baseDirectory => baseDirectory
};
