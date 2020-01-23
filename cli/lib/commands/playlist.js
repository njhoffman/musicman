const _ = require('lodash');
const path = require('path');
const fs = require('fs');

const logger = require('../utils/logger');

const writePlaylist = (files, outPath) => fs.writeFileSync(outPath, files.join('\n'));

const playlistCommand = async ({ target, options, config, utils }) => {
  const {
    file: { checkExists, getFiles, filterFiles },
    metadata: { getMetadata, parseFileMetadata }
  } = utils;

  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  } else if (!exists.isDirectory()) {
    throw new Error(`Target is not a directory: ${target}`);
  }

  const { recursive = config.recursive } = options.switches;

  const files = getFiles(target, { ext: 'mp3', recursive });

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles);

  const filtered = _.chain(parsedMetadata)
    .filter(filterFiles(options.filters))
    .map(([file, meta]) => [file.replace(config.mpd.baseDirectory, '').replace(/^\//, ''), meta])
    .value();

  const filteredPaths = _.map(filtered, ([file, meta]) => file);

  const { outputDirectory, outputPath } = config.playlist;
  const outPath = path.join(outputDirectory, outputPath);
  writePlaylist(filteredPaths, outPath);

  logger.info(`${filtered.length} files saved to playlist ${outPath}`);

  const filteredMeta = _.map(filtered, ([file, meta]) => meta);

  return logger.outputMetadata({ target, metadata: filteredMeta, config, options });
};

module.exports = { name: 'playlist', func: playlistCommand };
