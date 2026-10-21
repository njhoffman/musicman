const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const manifestPath = config => path.join(config.sync.downloadDirectory, 'manifest.json');

// the manifest written by sync --pull, null when there is none
const readManifest = config => {
  const file = manifestPath(config);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

// spotDL names files "<artists> - <title> [<track id>].mp3", so downloads are found by track id
const outputTemplate = config =>
  path.join(config.sync.downloadDirectory, '{artists} - {title} [{track-id}].{output-ext}');

const trackIdPattern = /\[([A-Za-z0-9]{22})\]\.mp3$/;

/**
 * Spotify track id of a downloaded file: from its name, or from the WOAS frame (the Spotify track URL
 * spotDL writes) of its raw tags; null when neither has one.
 */
const downloadTrackId = (file, rawTags = {}) => {
  const fromName = path.basename(file).match(trackIdPattern);
  if (fromName) {
    return fromName[1];
  }
  const url = _.get(rawTags, 'WOAS.url', rawTags.WOAS);
  const fromUrl = `${url || ''}`.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
  return fromUrl ? fromUrl[1] : null;
};

// mp3 files directly in the download directory
const downloadedFiles = config => {
  const directory = config.sync.downloadDirectory;
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .filter(name => name.endsWith('.mp3'))
    .sort()
    .map(name => path.join(directory, name));
};

// manifest tracks still to download: not imported yet and with no downloaded file
const pendingTracks = (manifest, files) => {
  const downloaded = new Set(_.compact(_.map(files, file => downloadTrackId(file))));
  return _.filter(
    _.get(manifest, 'tracks', []),
    track => !track.importedAt && !downloaded.has(track.trackId)
  );
};

// spotDL command and arguments for downloading track URLs as mp3 into the download directory
const spotdlCommand = (config, urls) => {
  const [command, ...args] = `${config.sync.spotdlCommand || 'spotdl'}`.split(/\s+/);
  return [
    command,
    [
      ...args,
      'download',
      ...urls,
      '--output',
      outputTemplate(config),
      '--format',
      'mp3',
      '--overwrite',
      'skip',
      '--print-errors'
    ]
  ];
};

module.exports = {
  downloadTrackId,
  downloadedFiles,
  manifestPath,
  outputTemplate,
  pendingTracks,
  readManifest,
  spotdlCommand
};
