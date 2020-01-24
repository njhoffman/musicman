const _ = require('lodash');
const path = require('path');
const fs = require('fs');

const { checkExists, getFiles, filterFiles } = require('../utils/files');
const { getMetadata, parseFileMetadata } = require('../utils/metadata');
const logger = require('../utils/logger');

const writePlaylist = (files, outPath) => fs.writeFileSync(outPath, files.join('\n'));

const playlistCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  } else if (!exists.isDirectory()) {
    throw new Error(`Target is not a directory: ${target}`);
  }

  const { recursive = config.recursive } = options.switches;

  const files = getFiles(target, { ext: 'mp3', recursive });

  const metadataFiles = await getMetadata(files);
  const parsedMetadata = parseFileMetadata(metadataFiles, config).filter(filterFiles(options.filters));

  const filtered = _.map(parsedMetadata, ([file, meta]) => [
    file.replace(config.mpd.baseDirectory, '').replace(/^\//, ''),
    meta
  ]);

  const { outputDirectory, outputPath } = config.playlist;
  const outPath = path.join(outputDirectory, outputPath);
  writePlaylist(_.unzip(filtered)[0], outPath);

  logger.info(`${filtered.length} files saved to playlist ${outPath}`);

  return logger.outputMetadata({ target, metadata: _.unzip(filtered)[1], config, options });
};

module.exports = { name: 'playlist', func: playlistCommand };
