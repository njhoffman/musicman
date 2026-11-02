const _ = require('lodash');
const fs = require('fs');
const { confirm: confirmPrompt } = require('../utils/confirm.js');

const { openLibrary, updateDatabase } = require('../db/index.js');
const { readBeetsConfig, readBeetsItems } = require('../spotify/beets.js');
const { sortCandidates, sortSongs, unsortedFolder, waitingSongs } = require('../beets/sort.js');
const logger = require('../utils/logger.js');

// songs waiting listed unless --all
const shownWaiting = 10;

// what keeps songs in the unsorted folder: counts per missing part, then the songs (the first
// shownWaiting, all with --all) with what each needs and its grouping hint
const reportWaiting = (waiting, { folder, all }) => {
  if (waiting.length === 0) {
    return;
  }
  const needs = part => _.filter(waiting, ({ missing }) => missing.includes(part)).length;
  const hinted = _.filter(waiting, 'hint').length;
  logger.info(
    `Waiting in ${folder}/: ${waiting.length} songs (${needs('rating')} need a rating, ${needs(
      'grouping'
    )} a grouping; ${hinted} have a grouping hint from Spotify)`
  );
  const shown = all ? waiting : _.take(waiting, shownWaiting);
  _.each(shown, ({ path: songPath, missing, hint }) =>
    logger.info(`  needs ${missing.join(' and ')}${hint ? ` (hint: ${hint})` : ''}  ${songPath}`)
  );
  if (shown.length < waiting.length) {
    logger.info(`  ... ${waiting.length - shown.length} more (musicman sort --all)`);
  }
};

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
    reportWaiting(waitingSongs(db, { beets }), {
      folder: unsortedFolder(beets),
      all: Boolean(_.get(options, 'switches.all'))
    });
    if (candidates.length === 0) {
      logger.info(`No rated songs with a sorted grouping in ${unsortedFolder(beets)}/`);
      return { candidates };
    }
    candidates.forEach(({ path: songPath, rating, grouping, fromHint, action }) =>
      logger.info(
        `${action === 'move' ? 'move  ' : 'import'} ${songPath} (${rating}, ${grouping}${
          fromHint ? ' from its Spotify playlist' : ''
        })`
      )
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
  usage: 'musicman sort [--dry-run] [--all]',
  switches: ['dry-run', 'all'],
  func: sortCommand,
  archive: true,
  defaultTarget,
  targetArgs: false,
  terms: false
};
