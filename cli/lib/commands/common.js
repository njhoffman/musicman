const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger.js');
const { backupIfDue, openLibrary, readStoredMetadata, updateDatabase } = require('../db/index.js');
const { getFiles } = require('../utils/files.js');
const {
  getMetadata,
  getMetadataFull,
  parseMetadata,
  writeFiles,
  filterFiles,
  mergeAssignments
} = require('../metadata.js');

const saveMetadata = (files, config) => _.map([files], writeFiles(config));

const assignMetadata =
  assignments =>
  ([file, meta]) =>
    [file, mergeAssignments(meta, assignments)];

// [file, parsed metadata], with raw id3 frames appended as a third element when withRaw is set
const readFileMetadata = (files, fullMetadata) =>
  fullMetadata ? getMetadataFull(files) : getMetadata(files);

// why the library database cannot be used for files, with whether to warn about it; null when it can
const databaseUnavailable = (files, { options = {}, config = {} }) => {
  if (_.get(options, 'switches.files') || _.isEmpty(files)) {
    return { warn: false };
  }
  const dbPath = _.get(config, 'db.path');
  if (!dbPath) {
    return { warn: false };
  }
  if (!fs.existsSync(dbPath)) {
    return { warn: true, reason: `no library database at ${dbPath} (run db --update)` };
  }
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  if (_.some(files, file => path.relative(baseDirectory, path.resolve(file)).startsWith('..'))) {
    return { warn: true, reason: `target is outside mpd.baseDirectory ${baseDirectory}` };
  }
  return null;
};

const openLibraryOrExplain = config => {
  try {
    return openLibrary(config);
  } catch (err) {
    (err.details || []).forEach(detail => logger.error(`  - ${detail}`));
    throw err;
  }
};

/**
 * [file, rawTags] for files, from the library database when it can be used, otherwise from the files.
 * Files missing from the database or changed since the last db --update are read from disk.
 */
const readMetadata = async ({ files, options, config, fullMetadata }) => {
  const unavailable = databaseUnavailable(files, { options, config });
  if (unavailable) {
    if (unavailable.warn) {
      logger.warn(`Reading files directly: ${unavailable.reason}`);
    }
    return readFileMetadata(files, fullMetadata);
  }

  const db = openLibraryOrExplain(config);
  let result;
  try {
    result = readStoredMetadata(db, { config, files });
  } finally {
    db.close();
  }
  const { stored, stale } = result;
  if (stale.length > 0) {
    logger.info(`${stale.length} files changed since the last db --update, reading them directly`);
  }
  const fromFiles = stale.length > 0 ? await readFileMetadata(stale, fullMetadata) : [];
  const byFile = new Map(
    _.map(stored, ([file, rawTags]) => [
      file,
      fullMetadata ? rawTags : _.omit(rawTags, ['duration', 'size'])
    ]).concat(fromFiles)
  );
  return _.map(files, file => [file, byFile.get(file)]);
};

// update the library database rows for files that were just written, when the database is in use
const updateLibraryFiles = async ({ files, options, config }) => {
  if (databaseUnavailable(files, { options, config })) {
    return null;
  }
  const db = openLibraryOrExplain(config);
  try {
    const backup = backupIfDue(db, config);
    if (backup) {
      logger.info(`Backed up database to ${backup.file}`);
    }
    return await updateDatabase(db, { config, files, record: false });
  } finally {
    db.close();
  }
};

const parseFileMetadata = (filesMetadata, config, withRaw = false) =>
  _.map(filesMetadata, ([file, metadata]) =>
    withRaw
      ? [file, parseMetadata(metadata, config), metadata]
      : [file, parseMetadata(metadata, config)]
  );

const getFilteredFiles = async (
  { target, options = {}, config = {}, fullMetadata = false, withRaw = false },
  fileList
) => {
  const { switches: { recursive = config.recursive } = {}, filters } = options;

  const files = fileList || getFiles(target, { ext: 'mp3', recursive });

  // logger.debug(`Getting metadata for ${files.length} files`);
  // TODO: fix memory overflow in event loop

  // files given explicitly (e.g. re-reading after a write) are always read from disk
  const metadataFiles = fileList
    ? await readFileMetadata(files, fullMetadata)
    : await readMetadata({ files, options, config, fullMetadata });

  // logger.debug(`Parsing metadata for ${metadataFiles.length} files`);
  const parsedFiles = parseFileMetadata(metadataFiles, config, withRaw);
  return filters ? _.filter(parsedFiles, filterFiles(filters)) : parsedFiles;
};

module.exports = {
  assignMetadata,
  getFilteredFiles,
  parseFileMetadata,
  saveMetadata,
  updateLibraryFiles
};
