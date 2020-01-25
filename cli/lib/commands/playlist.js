const _ = require('lodash');
const path = require('path');
const fs = require('fs');

const { getFilteredFiles } = require('./common');
const { checkExists } = require('../utils/files');
const logger = require('../utils/logger');

const writePlaylist = (files, outPath) => fs.writeFileSync(outPath, files.join('\n'));

const playlistCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  } else if (!exists.isDirectory()) {
    throw new Error(`Target is not a directory: ${target}`);
  }

  const filtered = await getFilteredFiles({ target, options, config });
  const filteredPaths = _.map(_.unzip(filtered)[0], ([file]) =>
    file.replace(config.mpd.baseDirectory, '').replace(/^\//, '')
  );

  const { outputDirectory, outputPath } = config.playlist;
  const outPath = path.join(outputDirectory, outputPath);
  writePlaylist(filteredPaths, outPath);

  logger.info(`${filtered.length} files saved to playlist ${outPath}`);

  return logger.outputMetadata({ target, metadata: _.unzip(filtered)[1], config, options });
};

module.exports = { name: 'playlist', func: playlistCommand };
