const _ = require('lodash');
const chalk = require('chalk').default;
const fs = require('fs');
const path = require('path');

const Confirm = require('prompt-confirm');
const { createClient } = require('../spotify/api.js');
const { appTokenGetter, readTokens, userAccessToken } = require('../spotify/auth.js');
const { getCredentials, missingCredentials, tokenPath } = require('../spotify/credentials.js');
const { login } = require('../spotify/login.js');
const { readBeetsConfig, readBeetsSpotifyIds } = require('../spotify/beets.js');
const {
  acceptReview,
  matchSongs,
  recheckMatches,
  rejectReview,
  reviewItems
} = require('../sync/match.js');
const { autoAcceptItems, confirmAutoAccept } = require('../sync/accept.js');
const { playlistTargets, songTargets } = require('../sync/targets.js');
const { refreshCache } = require('../sync/cache.js');
const { recordSynced, syncPlan } = require('../sync/plan.js');
const { membershipChanges } = require('../sync/membership.js');
const { pushPlan } = require('../sync/push.js');
const { buildManifest, writeManifest } = require('../sync/pull.js');
const { downloadedFiles, manifestPath, readManifest } = require('../sync/download.js');
const { importDownloads } = require('../sync/import.js');
const { applyBackup, backupPlan, removedFolder } = require('../sync/backup.js');
const { saveSnapshot } = require('../sync/snapshot.js');
const { recordSpotifySnapshot } = require('../history/journal.js');
const {
  reviewBinds,
  reviewHeader,
  reviewLines,
  sortForDecision,
  stopReviewPlayback
} = require('../output/review.js');
const { unsortedFolder } = require('../beets/sort.js');
const { formatWait, progressBar } = require('../output/progress.js');
const {
  formatMatchSummary,
  formatPlan,
  formatSongResult,
  formatUnassigned,
  highlight,
  matchCounts
} = require('../output/sync.js');
const { dim, emitFormatted } = require('../output/emit.js');
const { outputFormat } = require('../output/formats.js');
const { previewCommand } = require('../output/fzf.js');
const { openLibrary, updateDatabase } = require('../db/index.js');
const {
  assignMetadata,
  getFilteredFiles,
  saveMetadata,
  updateLibraryFiles
} = require('./common.js');
const logger = require('../utils/logger.js');

const credentialSource = (env, name) => (env[name] ? 'environment' : 'config');

// requests for the user (playlists, Liked Songs), paced like the lookups so a push is not rate limited
const userClient = ({ credentials, file, fetchImpl, config }) =>
  createClient({
    getToken: () => userAccessToken({ credentials, file, fetchImpl }),
    fetchImpl,
    requestsPerSecond: _.get(config, 'spotify.requestsPerSecond')
  });

const runLogin = async ({ credentials, file, fetchImpl, open, config }) => {
  await login({
    credentials,
    file,
    fetchImpl,
    open,
    onUrl: url => logger.info(`Log in to Spotify in the browser (opening it now): ${url}`)
  });
  // the login is complete once the token is saved, looking up the user is only informational
  try {
    const me = await userClient({ credentials, file, fetchImpl, config }).get('/me');
    logger.info(`Logged in to Spotify as ${me.display_name || me.id}, token saved to ${file}`);
    return { user: me.id };
  } catch (err) {
    logger.warn(
      `Logged in to Spotify, token saved to ${file}; could not look up the user: ${err.message}`
    );
    return { user: null };
  }
};

const showStatus = async ({ credentials, file, fetchImpl, env, config }) => {
  logger.info(
    `Spotify app: client id from ${credentialSource(env, 'SPOTIFY_CLIENT_ID')}, redirect ${
      credentials.redirectUri
    }`
  );
  if (!readTokens(file)) {
    logger.info('Not logged in, run: musicman sync --login');
    return { loggedIn: false };
  }
  const client = userClient({ credentials, file, fetchImpl, config });
  const me = await client.get('/me');
  logger.info(`Logged in as ${me.display_name || me.id}`);
  return { loggedIn: true, user: me.id, client };
};

// refresh the cache of Liked Songs and mapped playlists, then report what sync would change
const confirmPrompt = message => new Confirm({ message }).run();

// apply the plan after confirming, then refresh the cache of the targets that changed
const runPush = async ({ db, client, config, plan, prune, dryRun, confirm }) => {
  const total = key => _.sumBy(plan, target => (target[key] || []).length);
  const adds = total('add');
  const rejects = total('reject');
  const removes = (prune ? total('prune') : 0) + rejects;
  if (adds + removes === 0) {
    logger.info('Nothing to push');
    return [];
  }
  const message = `Add ${adds} tracks${
    removes
      ? ` and remove ${removes} tracks${rejects ? ` (${rejects} rejected in review)` : ''}`
      : ''
  } across Liked Songs and playlists?`;
  if (dryRun) {
    logger.info(`Dry run: would ${message.charAt(0).toLowerCase()}${message.slice(1, -1)}`);
    return [];
  }
  if (!(await confirm(message))) {
    logger.info('Push cancelled');
    return [];
  }
  // what Spotify had before the push, to restore from if a push goes wrong
  const snapshot = await saveSnapshot(client, config);
  recordSpotifySnapshot(snapshot.file);
  logger.info(`Saved Liked Songs and playlists as they were to ${snapshot.file}`);
  const results = await pushPlan(client, plan, {
    prune,
    onTarget: ({ name, added, removed }) =>
      (added || removed) &&
      logger.info(`${name}: added ${added}${removed ? `, removed ${removed}` : ''}`)
  });
  const changed = _.map(
    _.filter(results, ({ added, removed }) => added || removed),
    'id'
  );
  await refreshCache(db, client, _.without(changed, 'liked'));
  return results;
};

// apply the playlist changes made on Spotify to songs in the library as tag changes
const pullMembership = async ({ config, plan, dryRun, confirm }) => {
  const { assignments, decide } = membershipChanges(plan, config);
  const files = _.keys(assignments);
  _.each(assignments, (fields, file) =>
    logger.info(
      `${chalk.hex('#55BBDD')('TAG    ')}${dryRun ? chalk.hex('#777788').italic(' dry ') : ' '}${chalk.hex(
        '#55AA77'
      )(
        _.map(fields, (values, field) => values.map(value => `${field}:${value}`).join(' ')).join(
          ' '
        )
      )} ${dim(path.relative(config.mpd.baseDirectory, file))}`
    )
  );
  _.each(decide, ({ file, label, target, change }) =>
    logger.warn(
      `${chalk.hex('#DDCC44')('DECIDE ')} ${change} ${change === 'added' ? 'to' : 'from'} ${target} on Spotify: ${
        file ? path.relative(config.mpd.baseDirectory, file) : label
      }`
    )
  );
  if (decide.length > 0) {
    logger.info(
      'Changes to Liked Songs and grouping playlists are not turned into tags: change the rating or ' +
        'grouping (musicman edit), or undo the change on Spotify; until then they stay listed here'
    );
  }
  if (files.length === 0 || dryRun) {
    return { assignments, decide, tagged: 0 };
  }
  if (
    !(await confirm(
      `Apply the playlist changes made on Spotify to the tags of ${files.length} songs?`
    ))
  ) {
    logger.info('Tag changes cancelled');
    return { assignments, decide, tagged: 0 };
  }
  const songs = await getFilteredFiles({ options: {}, config }, files);
  saveMetadata(
    _.map(songs, ([file, meta]) => assignMetadata(assignments[file])([file, meta])),
    config
  );
  await updateLibraryFiles({ files, options: {}, config });
  logger.info(`Tagged ${files.length} songs from their Spotify playlists`);
  return { assignments, decide, tagged: files.length };
};

// write the download manifest for tracks that are only on Spotify, and pull the playlist changes made
// on Spotify into tags
const runPull = async ({ config, plan, dryRun, confirm }) => {
  const membership = await pullMembership({ config, plan, dryRun, confirm });
  const manifest = buildManifest(plan, config);
  const withoutIds = _.sumBy(plan, target => target.noId.length);
  if (withoutIds > 0) {
    logger.warn(
      `${withoutIds} songs have no Spotify id yet, so the manifest may list songs you already have (run sync --match first)`
    );
  }
  if (dryRun) {
    logger.info(`Dry run: would write ${manifest.tracks.length} tracks to the download manifest`);
    return { manifest, membership };
  }
  const file = writeManifest(config, manifest);
  logger.info(`Wrote ${manifest.tracks.length} tracks to download to ${file}`);
  return { manifest, file, membership };
};

const planColumns = [
  ['target', 'Target', target => target.name],
  ['spotify', 'Spotify', target => target.remote],
  ['local', 'Local', target => target.local],
  ['add', 'Add', target => target.add.length],
  ['noId', 'No id', target => target.noId.length],
  ['prune', 'Prune', target => target.prune.length],
  ['reject', 'Rejected', target => (target.reject || []).length],
  ['spotifyAdded', '+Spotify', target => target.spotifyAdded.length],
  ['spotifyRemoved', '-Spotify', target => target.spotifyRemoved.length],
  ['pull', 'Pull', target => target.pull.length]
];

const outputPlan = (plan, { config, switches, highlighted = [] }) => {
  if (outputFormat(switches) !== 'default') {
    emitFormatted({
      switches,
      config,
      title: 'musicman sync plan',
      records: _.map(plan, target =>
        _.fromPairs(_.map(planColumns, ([key, , value]) => [key, value(target)]))
      ),
      columns: _.map(planColumns, 0),
      oneline: record =>
        `${record.target}\t${chalk.bold(record.target)} ${dim(
          `spotify ${record.spotify}, local ${record.local}`
        )} add ${record.add}, no id ${record.noId}, prune ${record.prune}, spotify +${
          record.spotifyAdded
        } -${record.spotifyRemoved}, pull ${record.pull}`
    });
  } else {
    logger.info(`\n${formatPlan(plan, planColumns, highlighted)}`);
  }
  const total = key => {
    const count = _.sumBy(plan, target => target[key].length);
    return highlighted.includes(key) ? highlight(count) : count;
  };
  const scope = _.get(config, 'sync.scope');
  if (scope) {
    logger.info(`Only songs matching sync.scope (${scope}) are synced`);
  }
  logger.info(
    `To add: ${total('add')}, without a Spotify id: ${total('noId')} (sync --match), ` +
      `to prune: ${total('prune')}, changed on Spotify: +${total('spotifyAdded')} -${total(
        'spotifyRemoved'
      )} (sync --pull), to pull: ${total('pull')}`
  );
};

const runPlan = async ({
  client,
  config,
  push = false,
  pull = false,
  prune = false,
  dryRun = false,
  confirm = confirmPrompt,
  switches = {}
}) => {
  const db = openSyncLibrary(config);
  try {
    const playlistIds = _.map(playlistTargets(config), 'id');
    await refreshCache(db, client, playlistIds, {
      onTarget: (id, status, count) =>
        logger.progress(
          `Refreshing Spotify playlists: ${id} ${status}${count === undefined ? '' : ` (${count})`}`
        )
    });
    logger.progressDone();
    const plan = syncPlan(db, config, songTargets(await librarySongs(config), config));
    // the counts the command acts on stand out in the plan
    const highlighted = [
      ...(push ? ['add', ...(prune ? ['prune'] : [])] : []),
      ...(pull ? ['spotifyAdded', 'spotifyRemoved', 'pull'] : [])
    ];
    outputPlan(plan, { config, switches, highlighted });
    const pushed = push
      ? await runPush({ db, client, config, plan, prune, dryRun, confirm })
      : undefined;
    const pulled = pull ? await runPull({ config, plan, dryRun, confirm }) : undefined;
    // what Spotify and the tags agree on now is the state the next sync compares with
    if (!dryRun) {
      recordSynced(db, syncPlan(db, config, songTargets(await librarySongs(config), config)));
    }
    return { plan, pushed, pulled };
  } finally {
    db.close();
  }
};

const formatDuration = seconds =>
  seconds ? `${Math.floor(seconds / 60)}:${`${Math.round(seconds % 60)}`.padStart(2, '0')}` : '?';

// the library database is required for sync, songs and their Spotify ids are read from it
const openSyncLibrary = config => {
  if (!fs.existsSync(config.db.path)) {
    throw new Error(`No library database at ${config.db.path}, run: musicman db --update`);
  }
  return openLibrary(config);
};

const librarySongs = async config =>
  getFilteredFiles({
    target: config.mpd.baseDirectory,
    options: { switches: { recursive: true } },
    config
  });

// lists the review matches at least sync.autoAcceptPercent similar and accepts them after asking, all of
// them or all but the ones picked to leave out; without a terminal to ask in they stay in review
const runAutoAccept = async ({ db, config, client, items, threshold, dryRun, confirm, pick }) => {
  if (items.length === 0) {
    return 0;
  }
  const lines = reviewLines(items, { threshold });
  logger.info(
    `Matches at ${threshold}% or more, least similar first:\n${_.map(
      items,
      item => lines.get(item.file).split('\t')[2]
    ).join('\n')}`
  );
  if (dryRun) {
    logger.info(`Dry run: would ask to accept ${items.length} matches at ${threshold}% or more`);
    return 0;
  }
  if (!confirm) {
    logger.info(
      `${items.length} matches at ${threshold}% or more stay in review: there is no terminal to ` +
        'confirm them in, run sync --match in one'
    );
    return 0;
  }
  const { accept, leftOut } = await confirmAutoAccept({
    items,
    threshold,
    confirm,
    pickOut: async candidates => {
      const { selected = [] } = pickReview({
        switches: { fzf: true },
        config,
        title: 'leave out',
        records: reviewRecords(candidates),
        oneline: record => lines.get(record.path),
        pick,
        write: _.noop
      });
      return selected;
    }
  });
  if (accept.length === 0) {
    logger.info(`Nothing accepted, ${items.length} matches stay in review (sync --review)`);
    return 0;
  }
  const result = await acceptReview({ db, config, client, items: accept });
  result.failed.forEach(({ path: songPath, error }) =>
    logger.warn(`FAILED  ${songPath}: ${error}`)
  );
  logger.info(
    `Accepted ${result.accepted.length} matches${
      leftOut.length ? `, ${leftOut.length} left in review (sync --review)` : ''
    }${result.failed.length ? `, ${result.failed.length} failed` : ''}`
  );
  return result.accepted.length;
};

const runMatch = async ({
  credentials,
  file,
  fetchImpl,
  config,
  dryRun,
  refresh,
  recheck,
  verbose,
  confirm,
  pick
}) => {
  const db = openSyncLibrary(config);
  try {
    const songs = songTargets(await librarySongs(config), config);
    const rechecked = recheck ? recheckMatches({ db, config, songs, dryRun }) : [];
    rechecked.forEach(item =>
      logger.info(
        formatSongResult(
          'review',
          item,
          { source: 'recheck', candidate: item.candidate },
          { dryRun }
        )
      )
    );
    if (recheck) {
      logger.info(
        `${rechecked.length} matches moved to review by the current title rule (sync --review)` +
          `${dryRun ? ', dry run' : ''}`
      );
    }
    const startedAt = new Date();
    // lookups need no user, the app token avoids the user-read-private scope a market would need
    const client = createClient({
      getToken: appTokenGetter(credentials, { fetchImpl }),
      fetchImpl,
      requestsPerSecond: _.get(config, 'spotify.requestsPerSecond'),
      onWait: (seconds, reason) =>
        logger.progress(
          chalk.hex('#DDCC44')(`Spotify ${reason}, retrying in ${Math.ceil(seconds)}s`)
        )
    });
    const summary = await matchSongs({
      db,
      config,
      songs,
      client,
      beetsIds: readBeetsSpotifyIds(config.sync.beetsConfig),
      dryRun,
      refresh,
      onProgress: ({ done, total, ...counts }) =>
        logger.progress(
          progressBar({
            done,
            total,
            startedAt,
            label: 'Matching',
            unit: 'songs',
            detail: matchCounts(counts)
          })
        ),
      onSong: (status, item, result) =>
        logger[status === 'failed' ? 'warn' : 'info'](
          formatSongResult(status, item, result, { verbose, dryRun })
        )
    });
    logger.progressDone();
    const threshold = _.get(config, 'sync.autoAcceptPercent');
    const queue = reviewItems(db, config);
    const autoAccept = autoAcceptItems(queue, threshold);
    logger.info(
      formatMatchSummary(summary, {
        dryRun,
        threshold,
        autoAccept: autoAccept.length,
        toReview: queue.length - autoAccept.length
      })
    );
    if (summary.rateLimited) {
      const retryAt = new Date(Date.now() + summary.rateLimited.retryAfter * 1000);
      logger.warn(
        `Spotify rate limit reached, it lifts in ${formatWait(summary.rateLimited.retryAfter)} ` +
          `(around ${retryAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). ` +
          `${summary.skipped} songs were not looked up${
            dryRun ? '' : ', the matches so far are saved'
          }; run sync --match again then.`
      );
      process.exitCode = 1;
    }
    if (!_.isEmpty(summary.unassigned)) {
      logger.warn(
        `Spotify returned fields that are not written, add them to spotify.fields or spotify.ignore:\n${formatUnassigned(
          summary.unassigned
        )}`
      );
    }
    const accepted = await runAutoAccept({
      db,
      config,
      client,
      items: autoAccept,
      threshold,
      dryRun,
      confirm,
      pick
    });
    return { summary, rechecked: rechecked.length, autoAccept: autoAccept.length, accepted };
  } finally {
    db.close();
  }
};

// tag downloads from the manifest with their Spotify fields and playlist tags, then import with beets
const runImport = async ({ credentials, fetchImpl, config, dryRun, confirm }) => {
  const manifest = readManifest(config);
  if (!manifest) {
    throw new Error(`No manifest at ${manifestPath(config)}, run: musicman sync --pull`);
  }
  const beets = readBeetsConfig(config.sync.beetsConfig);
  if (!beets) {
    throw new Error(`No beets config at ${config.sync.beetsConfig} (sync.beetsConfig)`);
  }
  const files = downloadedFiles(config);
  if (files.length === 0) {
    logger.info(`No downloads in ${config.sync.downloadDirectory}, run: pnpm download`);
    return { import: null };
  }
  const message = `Tag and import ${files.length} downloads with beets into ${unsortedFolder(
    beets
  )}/?`;
  if (!dryRun && !(await confirm(message))) {
    logger.info('Import cancelled');
    return { import: null };
  }
  const db = dryRun ? null : openSyncLibrary(config);
  try {
    const beetsLog = path.join(config.sync.downloadDirectory, 'beets-import.log');
    if (!dryRun) {
      fs.rmSync(beetsLog, { force: true });
    }
    const label = (status, color) =>
      chalk.hex(color)(status.padEnd(7)) + (dryRun ? chalk.hex('#777788').italic(' dry') : '');
    const summary = await importDownloads({
      config,
      client: createClient({
        getToken: appTokenGetter(credentials, { fetchImpl }),
        fetchImpl,
        requestsPerSecond: _.get(config, 'spotify.requestsPerSecond')
      }),
      manifest,
      files,
      beetsLog,
      dryRun,
      onFile: (status, item, detail) =>
        status === 'unknown'
          ? logger.warn(`${label('SKIP', '#DD7744')} ${path.basename(item.file)}: ${detail}`)
          : logger.info(
              [
                label('TAG', '#55CC55'),
                `${item.entry.artists} - ${item.entry.name}`,
                chalk.hex('#55AA77')(`+${detail.custom.length} fields`),
                detail.filled.length > 0 && chalk.hex('#5599BB')(`~${detail.filled.length} filled`),
                dim(_.map(detail.playlist, ({ name, value }) => `${name}:${value}`).join(' '))
              ]
                .filter(Boolean)
                .join(' ')
            )
    });
    if (summary.detailsError) {
      logger.warn(
        `Spotify fields could not be fetched (${summary.detailsError}), the downloads got their ids ` +
          'and playlist tags; sync --match fills the fields later'
      );
    }
    if (!dryRun) {
      writeManifest(config, manifest);
      const update = await updateDatabase(db, {
        config,
        target: path.join(config.mpd.baseDirectory, unsortedFolder(beets))
      });
      logger.info(`Database: ${update.added} added, ${update.updated} updated`);
    }
    logger.info(
      [
        `Import ${dryRun ? '(dry run, nothing written)' : ''}`.trim(),
        `  downloads tagged: ${summary.tagged}, imported by beets: ${summary.imported}`,
        `  without a MusicBrainz match (imported as is): ${summary.asis.length}`,
        `  skipped by beets: ${summary.skipped.length}, not in the manifest: ${summary.unknown.length}`
      ].join('\n')
    );
    _.each(summary.skipped, file => logger.warn(`beets skipped ${file}`));
    return { import: summary };
  } finally {
    if (db) {
      db.close();
    }
  }
};

const formatSize = bytes =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

// a few files of a backup plan category on the terminal, every one in the log
const listBackupFiles = (label, entries, color, describe = entry => entry.path) => {
  _.each(entries, entry => logger.logToFile('info', `${label} ${describe(entry)}`));
  const shown = _.take(entries, 15);
  _.each(shown, entry => logger.info(`${chalk.hex(color)(label.padEnd(7))} ${describe(entry)}`));
  if (entries.length > shown.length) {
    logger.info(
      dim(`        ... and ${entries.length - shown.length} more (musicman logs latest)`)
    );
  }
};

// mirror the library files to backup.directory after showing and confirming the changes
const runBackup = async ({ config, dryRun, force = false, confirm }) => {
  const directory = _.get(config, 'backup.directory');
  if (!directory) {
    throw new Error('Set backup.directory in the config to the folder to back up to');
  }
  if (!fs.existsSync(directory)) {
    throw new Error(`Backup directory ${directory} does not exist (is the share mounted?)`);
  }
  const source = path.resolve(config.mpd.baseDirectory);
  logger.info(`Comparing ${source} with ${directory}`);
  const planned = backupPlan({ source, directory, exclude: _.get(config, 'backup.exclude', []) });
  // --force takes the library version of held files too
  const plan = force
    ? { ...planned, update: [...planned.update, ...planned.held], held: [] }
    : planned;
  if (force && planned.held.length > 0) {
    listBackupFiles(
      'FORCE',
      planned.held,
      '#DDCC44',
      entry => `${entry.path} (backup loses ${entry.frames.join(', ')})`
    );
  }
  if (plan.layoutHint) {
    const { folder, names } = plan.layoutHint;
    logger.error(
      `${directory} looks like a backup of ${folder}/ alone (it has ${names.join(', ')}), not of the whole ` +
        `library. Move those folders into ${path.join(directory, folder)} first, so they are compared ` +
        'with their library copies instead of being copied again.'
    );
    process.exitCode = 1;
    return {
      backup: { plan: _.omit(plan, ['copy', 'update', 'remove', 'held', 'rename']), applied: null }
    };
  }
  listBackupFiles('COPY', plan.copy, '#55CC55');
  listBackupFiles('UPDATE', plan.update, '#55BBDD');
  listBackupFiles(
    'HOLD',
    plan.held,
    '#DDCC44',
    entry => `${entry.path} (backup has ${entry.frames.join(', ')})`
  );
  listBackupFiles(
    'RENAME',
    plan.rename,
    '#BB88DD',
    ({ from, to }) => `${from} -> ${path.basename(to)}`
  );
  listBackupFiles('MOVE', plan.remove, '#DD7744');
  const size = entries => formatSize(_.sumBy(entries, 'size'));
  logger.info(
    [
      `Backup to ${directory}${dryRun ? ' (dry run, nothing changed)' : ''}`,
      `  copy (new): ${plan.copy.length} (${size(plan.copy)})`,
      `  update (changed): ${plan.update.length} (${size(plan.update)})`,
      `  unchanged: ${plan.unchanged}`,
      `  renamed to the library's capitalization: ${plan.rename.length}`,
      `  held back, the backup copy has frames the library copy lacks: ${plan.held.length}`,
      `  only in the backup, moved to ${removedFolder}/: ${plan.remove.length}`
    ].join('\n')
  );
  const changes = plan.copy.length + plan.update.length + plan.remove.length + plan.rename.length;
  const summary = {
    ..._.omit(plan, ['copy', 'update', 'remove', 'held', 'rename']),
    counts: _.mapValues(_.pick(plan, ['copy', 'update', 'remove', 'held', 'rename']), 'length')
  };
  if (changes === 0 || dryRun) {
    return { backup: { plan: summary, applied: null } };
  }
  const message =
    `${plan.rename.length ? `Rename ${plan.rename.length} folders and files to the library's capitalization, c` : 'C'}` +
    `opy ${plan.copy.length} and update ${plan.update.length} files in ${directory}` +
    `${plan.remove.length ? `, and move ${plan.remove.length} files only in the backup to ${removedFolder}/` : ''}?`;
  if (!(await confirm(message))) {
    logger.info('Backup cancelled');
    return { backup: { plan: summary, applied: null } };
  }
  const total = plan.copy.length + plan.update.length;
  const startedAt = new Date();
  let done = 0;
  const applied = applyBackup(plan, {
    onFile: (action, entry) => {
      logger.logToFile('debug', `${action} ${entry.path}`);
      if (action === 'copy' || action === 'update') {
        done += 1;
        logger.progress(
          progressBar({ done, total, startedAt, label: 'Backing up', unit: 'files' })
        );
      }
    }
  });
  logger.progressDone();
  logger.info(
    `Backed up ${applied.copied + applied.updated} files (${formatSize(applied.bytes)})` +
      `${applied.renamed ? `, renamed ${applied.renamed} to the library's capitalization` : ''}` +
      `${applied.moved ? `, moved ${applied.moved} to ${applied.removedTo}` : ''}`
  );
  if (applied.timesLost.length > 0) {
    logger.warn(
      `${applied.timesLost.length} backup copies did not keep their modified time (e.g. ${
        applied.timesLost[0]
      }), so the next backup copies them again; the backup file system may not keep times set on files`
    );
  }
  return { backup: { plan: summary, applied } };
};

const reviewRecords = items =>
  _.map(items, ({ file: songFile, duration, candidate, linked, similarity }) => ({
    path: songFile,
    duration,
    linked,
    similarity: similarity.percent,
    similarityDetails: similarity.details,
    spotifyId: candidate.id,
    spotifyArtists: candidate.artists,
    spotifyName: candidate.name,
    spotifyAlbum: candidate.album,
    spotifyDuration: candidate.durationMs / 1000
  }));

// fzf options of the review list: the hidden Spotify id field, the play binds, the song preview below
const reviewFzf = {
  withNth: '3..',
  binds: reviewBinds(),
  header: reviewHeader,
  // wide columns, so the song preview goes below the list
  previewWindow: 'down,40%,wrap',
  preview: previewCommand('view')
};

// picks review items with fzf, stopping a song still playing from the list afterwards
const pickReview = options => {
  try {
    return emitFormatted({ ...reviewFzf, ...options });
  } finally {
    stopReviewPlayback();
  }
};

// accept or reject the review items picked with fzf, offered most similar first to accept and least
// similar first to reject
const decideReview = async ({ db, config, items, accept, credentials, fetchImpl, pick }) => {
  const sorted = sortForDecision(items, accept);
  const lines = reviewLines(sorted, { threshold: _.get(config, 'sync.autoAcceptPercent') });
  const { selected = [] } = pickReview({
    switches: { fzf: true },
    config,
    title: accept ? 'accept' : 'reject',
    records: reviewRecords(sorted),
    oneline: record => lines.get(record.path),
    pick,
    write: _.noop
  });
  const picked = _.filter(items, ({ file: songFile }) => selected.includes(songFile));
  if (picked.length === 0) {
    logger.info('Nothing picked');
    return { picked };
  }
  const result = accept
    ? await acceptReview({
        db,
        config,
        client: createClient({ getToken: appTokenGetter(credentials, { fetchImpl }), fetchImpl }),
        items: picked
      })
    : await rejectReview({ db, config, items: picked });
  const done = accept ? result.accepted : result.rejected;
  done.forEach(({ path: songPath, candidate, linked }) =>
    logger.info(
      `${chalk.hex(accept ? '#55CC55' : '#DD7744')(accept ? 'ACCEPT ' : 'REJECT ')} ${songPath} ${dim(
        '->'
      )} ${candidate.artists} - ${candidate.name}${
        !accept && linked ? dim(' (unlinked, removed from Spotify by the next push)') : ''
      }`
    )
  );
  result.failed.forEach(({ path: songPath, error }) =>
    logger.warn(`FAILED  ${songPath}: ${error}`)
  );
  logger.info(
    accept
      ? `Accepted ${done.length} matches`
      : `Rejected ${done.length} matches; sync --match looks the songs up again, sync --push removes rejected tracks`
  );
  return { picked, ...result };
};

const runReview = async ({ config, switches = {}, credentials, fetchImpl, pick }) => {
  const db = openSyncLibrary(config);
  try {
    const items = reviewItems(db, config);
    if (switches.accept || switches.reject) {
      if (items.length === 0) {
        logger.info('No Spotify matches waiting for review');
        return { review: items };
      }
      const decided = await decideReview({
        db,
        config,
        items,
        accept: Boolean(switches.accept),
        credentials,
        fetchImpl,
        pick
      });
      return { review: items, ...decided };
    }
    if (outputFormat(switches) !== 'default') {
      const lines = reviewLines(items, { threshold: _.get(config, 'sync.autoAcceptPercent') });
      const { selected } = pickReview({
        switches,
        config,
        title: 'musicman sync review',
        records: reviewRecords(items),
        oneline: record => lines.get(record.path),
        pick
      });
      return { review: items, selected };
    }
    if (items.length === 0) {
      logger.info('No Spotify matches waiting for review');
    }
    items.forEach(({ path: songPath, duration, candidate, linked, similarity }) =>
      logger.info(
        [
          `${songPath} (${formatDuration(duration)})${linked ? chalk.hex('#DDCC44')(' linked') : ''}` +
            ` ${similarity.percent}%${similarity.details ? dim(` ${similarity.details}`) : ''}`,
          `  Spotify: ${candidate.artists} - ${candidate.name} [${
            candidate.album
          }] (${formatDuration(candidate.durationMs / 1000)})`
        ].join('\n')
      )
    );
    if (items.length > 0) {
      logger.info(
        `${items.length} to review: sync --review --accept or --reject picks matches with fzf` +
          `${_.some(items, 'linked') ? '; linked ones are already on Spotify' : ''}`
      );
    }
    return { review: items };
  } finally {
    db.close();
  }
};

// sync: Spotify status; sync --login: log in to Spotify
const syncCommand = async ({
  options,
  config,
  fetchImpl,
  open,
  confirm,
  pick,
  env = process.env,
  file = tokenPath(env)
}) => {
  const credentials = getCredentials(config, env);
  const missing = missingCredentials(credentials);
  if (missing.length > 0) {
    logger.error(`Spotify credentials missing: ${missing.join(', ')}`);
    process.exitCode = 1;
    return false;
  }
  try {
    const switches = _.get(options, 'switches', {});
    if (switches.login) {
      return await runLogin({ credentials, file, fetchImpl, open, config });
    }
    if (switches.match) {
      return await runMatch({
        credentials,
        file,
        fetchImpl,
        config,
        dryRun: Boolean(switches.dryRun),
        refresh: Boolean(switches.refresh),
        recheck: Boolean(switches.recheck),
        verbose: Boolean(switches.verbose),
        // auto-accept asks first, so without a terminal nothing is accepted
        confirm: confirm || (process.stdin.isTTY ? confirmPrompt : null),
        pick
      });
    }
    if (switches.backup) {
      return await runBackup({
        config,
        dryRun: Boolean(switches.dryRun),
        force: Boolean(switches.force),
        confirm: confirm || confirmPrompt
      });
    }
    if (switches.import) {
      return await runImport({
        credentials,
        fetchImpl,
        config,
        dryRun: Boolean(switches.dryRun),
        confirm: confirm || confirmPrompt
      });
    }
    if (switches.review) {
      return await runReview({ config, switches, credentials, fetchImpl, pick });
    }
    const status = await showStatus({ credentials, file, fetchImpl, env, config });
    if (!status.loggedIn) {
      return status;
    }
    const { plan, pushed, pulled } = await runPlan({
      client: status.client,
      config,
      push: Boolean(switches.push),
      pull: Boolean(switches.pull),
      prune: Boolean(switches.prune),
      dryRun: Boolean(switches.dryRun),
      confirm,
      switches
    });
    return { ..._.omit(status, 'client'), plan, pushed, pulled };
  } catch (err) {
    logger.error(err.message);
    logger.logToFile('error', err.stack);
    process.exitCode = 1;
    return false;
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'sync',
  description: 'Sync Liked Songs and playlists with Spotify; without switches, show the plan',
  usage:
    'musicman sync [--login | --match [--refresh] [--recheck] [--verbose] | --review [--accept | --reject] | --push [--prune] | --pull | --import | --backup [--force]] [--dry-run]',
  switches: [
    'login',
    'match',
    'refresh',
    'recheck',
    'verbose',
    'review',
    'accept',
    'reject',
    'push',
    'prune',
    'pull',
    'import',
    'backup',
    'force',
    'dry-run',
    'format',
    'fzf'
  ],
  func: syncCommand,
  // reviewing only lists, accepting or rejecting changes tags
  archive: ({ review, accept, reject }) => !review || Boolean(accept || reject),
  defaultTarget,
  targetArgs: false,
  terms: false
};
