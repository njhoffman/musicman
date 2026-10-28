const _ = require('lodash');
const chalk = require('chalk').default;
const path = require('path');
const Confirm = require('prompt-confirm');

const { createClient } = require('../spotify/api.js');
const { readTokens, userAccessToken } = require('../spotify/auth.js');
const { getCredentials, tokenPath } = require('../spotify/credentials.js');
const { applyUndo, findHistoryRun, listHistory, planUndo } = require('../history/undo.js');
const { openLibrary } = require('../db/index.js');
const { dim } = require('../output/emit.js');
const logger = require('../utils/logger.js');

const confirmPrompt = message => new Confirm({ message }).run();

const runLine = run =>
  [
    run.id.padEnd(30),
    `${run.files} files`.padEnd(10),
    `${run.spotify} Spotify`.padEnd(11),
    run.undoneBy ? chalk.hex('#DDCC44')(`undone by ${run.undoneBy}`) : '',
    run.undoes ? dim(`undoes ${run.undoes}`) : '',
    dim(run.args.join(' '))
  ]
    .filter(Boolean)
    .join('  ');

const shortPath = (config, file) => {
  const relative = path.relative(path.resolve(config.mpd.baseDirectory), file);
  return relative.startsWith('..') ? file : relative;
};

// what undoing a run does: files restored, held back, or gone, and the Spotify changes reversed
const describePlan = (config, plan) => {
  const byStatus = _.groupBy(plan.files, 'status');
  // the recorded args start with the command name
  const lines = [`Undo ${plan.run.id} (${plan.run.args.join(' ')})`];
  (byStatus.restore || []).forEach(({ file, frames }) =>
    lines.push(`  RESTORE ${shortPath(config, file)} ${dim(_.map(frames, 'frame').join(', '))}`)
  );
  (byStatus.changed || []).forEach(({ file, changed }) =>
    lines.push(
      chalk.hex('#DDCC44')(`  CHANGED ${shortPath(config, file)}`) +
        dim(` ${changed.join(', ')} changed since, --force restores it anyway`)
    )
  );
  (byStatus.missing || []).forEach(({ file }) =>
    lines.push(
      chalk.hex('#DD7744')(`  MISSING ${shortPath(config, file)}`) + dim(' moved or deleted')
    )
  );
  _.each(_.groupBy(plan.spotify, 'targetName'), (changes, name) => {
    const [added, removed] = _.partition(changes, { action: 'add' });
    lines.push(
      `  SPOTIFY ${name}: remove ${_.uniqBy(added, 'trackId').length} added, add back ${
        _.uniqBy(removed, 'trackId').length
      } removed`
    );
  });
  return lines.join('\n');
};

// Spotify requests for the logged in user, null when not logged in
const spotifyClient = ({ config, env, fetchImpl, file }) => {
  if (!readTokens(file)) {
    return null;
  }
  const credentials = getCredentials(config, env);
  return createClient({
    getToken: () => userAccessToken({ credentials, file, fetchImpl }),
    fetchImpl,
    requestsPerSecond: _.get(config, 'spotify.requestsPerSecond')
  });
};

// undo [--list]: list recent runs with changes; undo <run | latest> [--dry-run] [--force]: undo one
const undoCommand = async ({
  options,
  config,
  confirm = confirmPrompt,
  env = process.env,
  fetchImpl,
  client: givenClient,
  file = tokenPath(env)
}) => {
  const { switches = {} } = options;
  const term = _.first(options.terms || []);
  const db = openLibrary(config);
  try {
    const runs = listHistory(db);
    if (!term || switches.list) {
      if (runs.length === 0) {
        logger.info('No recorded changes to undo yet');
      } else {
        logger.consoleLog(runs.map(runLine).join('\n'));
        logger.info(`musicman undo <run id | latest> undoes one, --dry-run shows what it would do`);
      }
      return { runs };
    }
    const run = findHistoryRun(runs, term);
    if (!run) {
      logger.error(`No run with recorded changes matches '${term}', see musicman undo --list`);
      process.exitCode = 1;
      return { runs, run: null };
    }
    if (run.undoneBy) {
      logger.error(`${run.id} was already undone by ${run.undoneBy}; undo that run to redo it`);
      process.exitCode = 1;
      return { run };
    }
    const plan = planUndo(db, run, { force: Boolean(switches.force) });
    logger.info(describePlan(config, plan));
    const restore = _.filter(plan.files, { status: 'restore' }).length;
    if (restore === 0 && plan.spotify.length === 0) {
      logger.info('Nothing to undo');
      return { plan };
    }
    if (switches.dryRun) {
      return { plan };
    }
    const client =
      plan.spotify.length > 0
        ? givenClient || spotifyClient({ config, env, fetchImpl, file })
        : null;
    if (plan.spotify.length > 0 && !client) {
      logger.error(
        'Undoing Spotify changes needs a Spotify login, run musicman sync --login first'
      );
      process.exitCode = 1;
      return { plan };
    }
    if (!(await confirm(`Undo ${run.id}?`))) {
      logger.info('Undo cancelled');
      return { plan };
    }
    const result = await applyUndo({ db, config, client, plan });
    result.tags.failed.forEach(({ file: failedFile, error }) =>
      logger.warn(`FAILED  ${shortPath(config, failedFile)}: ${error}`)
    );
    const { spotify } = result;
    logger.info(
      [
        `Restored ${result.tags.restored.length} files`,
        plan.spotify.length > 0
          ? `; on Spotify removed ${spotify.removed.length} and added back ${spotify.added.length} tracks` +
            `${spotify.skipped.length ? `, ${spotify.skipped.length} already as before` : ''}`
          : ''
      ].join('')
    );
    if (spotify.snapshot) {
      logger.info(
        `Saved Liked Songs and playlists as they were before the undo to ${spotify.snapshot}`
      );
    }
    if (spotify.removed.length > 0) {
      logger.info(
        dim(
          'Tracks still belong where the tags put them, so sync --push adds them again unless the tags change'
        )
      );
    }
    return { plan, result };
  } finally {
    db.close();
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'undo',
  description:
    'Undo the tag and Spotify changes of a recent run, or list the runs that can be undone',
  usage: 'musicman undo [--list | <run id | latest> [--dry-run] [--force]]',
  switches: ['list', 'dry-run', 'force'],
  words: ['latest'],
  func: undoCommand,
  defaultTarget,
  targetArgs: false,
  // listing and previews change nothing; an undo is recorded, so it can be undone too
  archive: ({ list, dryRun }) => !list && !dryRun
};
