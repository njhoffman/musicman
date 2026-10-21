const _ = require('lodash');
const path = require('path');
const fs = require('fs');

const { getFilteredFiles, libraryScanOptions } = require('./common.js');
const { checkExists } = require('../utils/files.js');
const logger = require('../utils/logger.js');
const { outputMetadata } = require('../output/index.js');

const writePlaylist = (files, outPath) => fs.writeFileSync(outPath, files.join('\n'));

const playlistCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  } else if (!exists.isDirectory()) {
    throw new Error(`Target is not a directory: ${target}`);
  }

  const filtered = await getFilteredFiles({ target, options: libraryScanOptions(options), config });
  // playlist entries are relative to the MPD music directory
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const filteredPaths = _.map(_.unzip(filtered)[0], file =>
    path.relative(baseDirectory, path.resolve(file))
  );

  const { outputDirectory, outputPath } = config.playlist;
  const playlistPath = options.switches.write ? options.switches.write : outputPath;
  const outPath = path.join(outputDirectory, playlistPath.replace(/\.m3u$|$/, '.m3u'));
  writePlaylist(filteredPaths, outPath);

  logger.info(`${filtered.length} files saved to playlist ${outPath}`);

  return outputMetadata({ target, metadata: _.unzip(filtered)[1], config, options });
};

module.exports = {
  name: 'playlist',
  description: 'Write the files matching filters to an MPD playlist',
  usage: 'musicman playlist [target] [field:value ...] [-w name]',
  switches: ['recursive', 'norecursive', 'write', 'files'],
  func: playlistCommand,
  // without a target the whole library is searched
  defaultTarget: baseDirectory => baseDirectory,
  archive: true
};
