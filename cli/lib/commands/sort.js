const _ = require('lodash');
const fs = require('fs');
const Confirm = require('prompt-confirm');

const { openLibrary, updateDatabase } = require('../db/index.js');
const { readBeetsConfig, readBeetsItems } = require('../spotify/beets.js');
const { sortCandidates, sortSongs, unsortedFolder } = require('../beets/sort.js');
const logger = require('../utils/logger.js');

const confirmPrompt = message => new Confirm({ message }).run();

// sort: have beets move rated songs with a sorted grouping out of its unsorted folder
const sortCommand = async ({ options, config, runBeet, confirm = confirmPrompt }) => {
  const dryRun = Boolean(_.get(options, 'switches.dryRun'));
  const beets = readBeetsConfig(config.sync.beetsConfig);
  if (!beets) {
    logger.error(`No beets config at ${config.sync.beetsConfig} (sync.beetsConfig)`);
    process.exitCode = 1;
    return false;
  }
  if (!fs.existsSync(config.db.path)) {
    logger.error(`No library database at ${config.db.path}, run: musicman db --update`);
    process.exitCode = 1;
    return false;
  }

  const db = openLibrary(config);
  try {
    const candidates = sortCandidates(db, { config, beets, beetsItems: readBeetsItems(beets) });
    if (candidates.length === 0) {
      logger.info(`No rated songs with a sorted grouping in ${unsortedFolder(beets)}/`);
      return { candidates };
    }
    candidates.forEach(({ path: songPath, rating, grouping, action }) =>
      logger.info(`${action === 'move' ? 'move  ' : 'import'} ${songPath} (${rating}, ${grouping})`)
    );
    const imports = _.filter(candidates, { action: 'import' }).length;
    const message = `Sort ${candidates.length} songs with beets (${imports} not in the beets library yet)?`;
    if (dryRun) {
      logger.info(`Dry run: would ${message.charAt(0).toLowerCase()}${message.slice(1, -1)}`);
      return { candidates };
    }
    if (!(await confirm(message))) {
      logger.info('Sort cancelled');
      return { candidates };
    }

    const result = await sortSongs(candidates, {
      beetsConfig: config.sync.beetsConfig,
      runBeet,
      onSong: (status, { path: songPath }, error) =>
        status === 'failed'
          ? logger.warn(`failed ${songPath}: ${error}`)
          : logger.logToFile('info', `sorted ${songPath}`)
    });
    // the moved files are picked up (and re-linked by MusicBrainz id) by a library update
    const summary = await updateDatabase(db, { config, target: config.mpd.baseDirectory });
    logger.info(
      `Sorted ${result.sorted} songs (${result.failed} failed); database: ${summary.added} added, ${summary.moved} moved, ` +
        `${summary.removed} removed`
    );
    return { candidates, ...result, summary };
  } finally {
    db.close();
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'sort',
  description: 'Move rated songs with a sorted grouping out of Unrated with beets',
  usage: 'musicman sort [--dry-run]',
  switches: ['dry-run'],
  func: sortCommand,
  archive: true,
  defaultTarget,
  targetArgs: false
};
