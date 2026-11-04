const _ = require('lodash');
const chalk = require('chalk').default;
const fs = require('fs');
const path = require('path');

const { confirm: confirmPrompt } = require('../utils/confirm.js');
const { runningRuns, runsDirectory } = require('../utils/runs.js');
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
const { ignorePlaylistId, likedId, playlistTargets, songTargets } = require('../sync/targets.js');
const { refreshCache } = require('../sync/cache.js');
const { recordSynced, syncPlan } = require('../sync/plan.js');
const {
  applyExport,
  confirmStaged,
  planExport,
  readExportState,
  spotifyReadable,
  writeExportState
} = require('../sync/localFiles.js');
const { mirrorToPhone } = require('../sync/phone.js');
const { membershipChanges } = require('../sync/membership.js');
const { pushPlan } = require('../sync/push.js');
const { buildManifest, writeManifest } = require('../sync/pull.js');
const { downloadedFiles, manifestPath, readManifest } = require('../sync/download.js');
const {
  importDownloads,
  importedMoves,
  recoverImports,
  staleDownloads
} = require('../sync/import.js');
const {
  applyBackup,
  backupPlan,
  defaultKeepRemovedDays,
  defaultKeepReplaced,
  removedFolder,
  replacedFolder
} = require('../sync/backup.js');
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
const { pathLayouts } = require('../beets/layout.js');

// the beets path rules, which tell songs organized in albums from singles (none without a beets config)
const beetsLayouts = config =>
  pathLayouts(_.get(readBeetsConfig(config.sync.beetsConfig), 'paths'));
const { formatClock, formatWait, progressBar } = require('../output/progress.js');
const {
  backupColors,
  formatBackupSummary,
  formatImportSummary,
  formatMatchSummary,
  formatPlan,
  formatPushResults,
  formatSize,
  formatSongResult,
  formatUnassigned,
  highlight,
  matchCounts
} = require('../output/sync.js');
const { dim, emitFormatted } = require('../output/emit.js');
const { outputFormat } = require('../output/formats.js');
const { previewCommand } = require('../output/fzf.js');
const { relinkHistory } = require('../history/relink.js');
const { openLibrary, updateDatabase } = require('../db/index.js');
const { getMeta, setMeta } = require('../db/database.js');
const { updateTags } = require('../metadata/write.js');
const {
  featureFields,
  featureWrites,
  fetchFeatures,
  songsForFeatures
} = require('../sync/features.js');
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

// every track a push added or removed, per target, by its local file when it has one
const listPushed = (config, plan, prune) =>
  _.each(plan, target => {
    const label = ({ file, name, artists }) =>
      file ? path.relative(config.mpd.baseDirectory, file) : `${artists} - ${name}`;
    _.each(_.uniqBy(target.add, 'trackId'), song =>
      logger.info(`${chalk.hex('#55CC55')('ADD    ')} ${target.name}: ${label(song)}`)
    );
    _.each(
      _.uniqBy([...(target.reject || []), ...(prune ? target.prune : [])], 'track_id'),
      track => logger.info(`${chalk.hex('#DD7744')('REMOVE ')} ${target.name}: ${label(track)}`)
    );
  });

// apply the plan after confirming, then refresh the cache of the targets that changed
const runPush = async ({ db, client, config, plan, prune, dryRun, confirm, verbose = false }) => {
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
  const lists = 1 + _.uniq(_.map(playlistTargets(config), 'id')).length;
  const savingStarted = new Date();
  let saved = 0;
  const snapshot = await saveSnapshot(client, config, {
    onTarget: () => {
      saved += 1;
      logger.progress(
        progressBar({
          done: saved,
          total: lists,
          startedAt: savingStarted,
          label: 'Saving Spotify',
          unit: 'lists'
        })
      );
    }
  });
  logger.progressDone();
  recordSpotifySnapshot(snapshot.file);
  logger.info(`Saved Liked Songs and playlists as they were to ${snapshot.file}`);
  const pushStarted = new Date();
  const results = await pushPlan(client, plan, {
    prune,
    onProgress: ({ done, total, target }) =>
      logger.progress(
        progressBar({
          done,
          total,
          startedAt: pushStarted,
          label: 'Pushing',
          unit: 'tracks',
          detail: target
        })
      )
  });
  logger.progressDone();
  if (verbose) {
    listPushed(config, plan, prune);
  }
  logger.info(`Pushed to Spotify\n${indented(formatPushResults(results))}`);
  const changed = _.map(
    _.filter(results, ({ added, removed }) => added || removed),
    'id'
  );
  await refreshCache(db, client, _.without(changed, 'liked'), {
    onProgress: refreshProgress('Refreshing the changed playlists')
  });
  logger.progressDone();
  return results;
};

// a progress bar for refreshCache: playlists done, and the tracks fetched of the one being fetched
const refreshProgress = label => {
  const startedAt = new Date();
  return ({ done, total, name, fetched, tracks }) =>
    logger.progress(
      progressBar({
        done,
        total,
        label,
        unit: 'playlists',
        startedAt,
        detail: dim(
          `${name}${tracks ? ` ${fetched}/${tracks} tracks` : fetched ? ` ${fetched} tracks` : ''}`
        )
      })
    );
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

// songs in the targets without a Spotify id, each once though it belongs in several targets
const songsWithoutIds = plan => _.uniqBy(_.flatMap(plan, 'noId'), 'file');

// what the songs without a Spotify id are, by match status: { message, unchecked } or null. Only songs
// never looked up can be on Spotify already, and so be listed in the manifest though you have them
const withoutIdsMessage = plan => {
  const songs = songsWithoutIds(plan);
  if (songs.length === 0) {
    return null;
  }
  const counts = _.countBy(songs, song => song.match || 'unchecked');
  const parts = _.compact([
    counts.unchecked && `${counts.unchecked} not looked up yet (sync --match)`,
    counts.missing && `${counts.missing} not found on Spotify`,
    counts.review && `${counts.review} in review (sync --review)`,
    counts.rejected && `${counts.rejected} rejected in review`
  ]);
  const unchecked = counts.unchecked || 0;
  return {
    unchecked,
    message:
      `${songs.length} songs in the targets have no Spotify id: ${parts.join(', ')}` +
      (unchecked > 0 ? '; the manifest may list the ones not looked up though you have them' : '')
  };
};

// write the download manifest for tracks that are only on Spotify, and pull the playlist changes made
// on Spotify into tags
const runPull = async ({ config, plan, dryRun, confirm }) => {
  const membership = await pullMembership({ config, plan, dryRun, confirm });
  const manifest = buildManifest(plan, config);
  const withoutIds = withoutIdsMessage(plan);
  if (withoutIds) {
    logger[withoutIds.unchecked > 0 ? 'warn' : 'info'](withoutIds.message);
  }
  if (dryRun) {
    logger.info(`Dry run: would write ${manifest.tracks.length} tracks to the download manifest`);
    return { manifest, membership };
  }
  const file = writeManifest(config, manifest);
  logger.info(`Wrote ${manifest.tracks.length} tracks to download to ${file}`);
  return { manifest, file, membership };
};

// a table logged under a title line: the title takes the log badge, the table lines are indented below
const indented = table => _.map(table.split('\n'), line => `  ${line}`).join('\n');

const planColumns = [
  ['target', 'Target', target => target.name],
  ['spotify', 'Spotify', target => target.remote],
  ['local', 'Local', target => target.local],
  ['add', 'Add', target => target.add.length],
  ['conflict', 'Conflict', target => (target.conflict || []).length],
  ['noId', 'No id', target => target.noId.length],
  [
    'localFiles',
    'Local files',
    target =>
      target.localFiles
        ? `${target.localFiles.added.length}/${
            target.localFiles.added.length + target.localFiles.pending.length
          }`
        : '0/0'
  ],
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
        )} add ${record.add}, conflict ${record.conflict}, no id ${record.noId}, prune ${record.prune}, spotify +${
          record.spotifyAdded
        } -${record.spotifyRemoved}, pull ${record.pull}`
    });
  } else {
    logger.info(`Sync plan\n${indented(formatPlan(plan, planColumns, highlighted))}`);
  }
  const total = key => {
    // a song without an id counts once, though it belongs in several targets
    const count =
      key === 'noId' ? songsWithoutIds(plan).length : _.sumBy(plan, target => target[key].length);
    return highlighted.includes(key) ? highlight(count) : count;
  };
  const scope = _.get(config, 'sync.scope');
  if (scope) {
    logger.info(`Only songs matching sync.scope (${scope}) are synced`);
  }
  logger.info(
    `To add: ${total('add')}, songs without a Spotify id: ${total('noId')}, ` +
      `to prune: ${total('prune')}, changed on Spotify: +${total('spotifyAdded')} -${total(
        'spotifyRemoved'
      )} (sync --pull), to pull: ${total('pull')}`
  );
  const conflicts = _.uniq(_.flatMap(plan, target => _.map(target.conflict || [], 'trackId')));
  if (conflicts.length > 0) {
    logger.warn(
      `Not added: ${conflicts.length} tracks whose copies belong in different rating or grouping ` +
        'playlists (check --only=exclusive)'
    );
  }
};

// the export of songs Spotify has no track for to sync.uploadDirectory (sync --export)
// the exported songs mirrored to the phone in sync.phone (KDE Connect), when one is set
const runPhone = async ({ config, exported, dryRun, connect }) => {
  const phone = _.get(config, 'sync.phone');
  if (!phone) {
    return undefined;
  }
  if (!phone.device) {
    logger.warn('sync.phone has no device (its KDE Connect name or id), the phone is not synced');
    return undefined;
  }
  const uploadDirectory = config.sync.uploadDirectory;
  const state = readExportState(uploadDirectory);
  const songs = _.map(exported.songs, song => ({
    file: path.join(uploadDirectory, 'files', song.name),
    name: song.name
  }));
  const startedAt = new Date();
  const result = await mirrorToPhone({
    songs,
    phone,
    sent: state.phone || {},
    dryRun,
    connect,
    onProgress: (done, total, name) =>
      logger.progress(
        progressBar({
          label: `Copying to ${phone.device}`,
          done,
          total,
          startedAt,
          unit: 'songs',
          detail: name
        })
      )
  });
  logger.progressDone();
  if (result.status === 'dry') {
    logger.info(
      `Dry run: would copy ${result.plan.copy.length} songs to ${phone.device} and remove ` +
        `${result.plan.remove.length} (as of the last copy)`
    );
  } else if (result.status === 'unreachable') {
    logger.warn(`${phone.device} is not reachable through KDE Connect, the phone is not synced`);
  } else if (result.status === 'unmounted') {
    logger.warn(
      `${phone.device}: its storage could not be mounted (allow file access in the KDE Connect app)`
    );
  } else {
    writeExportState(uploadDirectory, { ...readExportState(uploadDirectory), phone: result.sent });
    logger.info(
      `${phone.device}: ${result.copied} songs copied, ${result.removed} removed (${result.directory})`
    );
    if (result.error) {
      logger.error(
        `Copying to ${phone.device} stopped (the phone full, or the connection gone?): ${result.error}; ` +
          'run sync --export again to go on'
      );
      process.exitCode = 1;
    }
  }
  return result;
};

const runExport = async ({ config, plan, dryRun, connect, confirmLiked = false }) => {
  const uploadDirectory = config.sync.uploadDirectory;
  let previous = readExportState(uploadDirectory);
  if (confirmLiked) {
    const { state, count } = confirmStaged(previous);
    previous = state;
    if (!dryRun) {
      writeExportState(uploadDirectory, previous);
    }
    logger.info(
      `${dryRun ? 'Dry run: would confirm' : 'Confirmed'} ${count} staged songs as added to Liked Songs`
    );
  }
  const exported = planExport(plan, {
    baseDirectory: path.resolve(config.mpd.baseDirectory),
    previous,
    readable: spotifyReadable
  });
  if (exported.unreadable.length > 0) {
    logger.warn(
      `${exported.unreadable.length} songs left out, Spotify cannot list them (MPEG layer II audio in a ` +
        `.mp3 file, convert them to MP3): ${exported.unreadable.join(', ')}`
    );
  }
  const { staged } = exported;
  const pending = _.sumBy(exported.targets, target => target.pending.length);
  logger.info(
    `Local files: ${exported.songs.length} songs Spotify has no track for, ${pending} still to add to ` +
      `their playlists (${uploadDirectory})`
  );
  const stray = _.sumBy(exported.targets, target => target.stray.length);
  if (stray > 0) {
    logger.warn(
      `${stray} local tracks in the playlists are none of these songs (tags changed since?), listed in README.md`
    );
  }
  if (dryRun) {
    logger.info(
      staged
        ? `Dry run: would stage ${staged.pending.length} songs for ${staged.name}`
        : 'Dry run: every song is in its playlists, nothing to stage'
    );
    return { exported, phone: await runPhone({ config, exported, dryRun, connect }) };
  }
  const counts = applyExport(exported, { uploadDirectory, previous });
  logger.info(
    `files/: ${counts.linked + counts.copied} added${
      counts.copied ? ` (${counts.copied} copied, not linked)` : ''
    }, ${counts.relinked} linked again, ${counts.removed} removed`
  );
  const liked = staged && staged.id === likedId;
  logger.info(
    staged
      ? `stage/: ${counts.staged} songs for ${chalk.bold(staged.name)}: in the desktop app, turn the files ` +
          `source off, select all in Local Files, drag them into the ${
            liked ? 'Liked Songs (or like them all)' : 'playlist'
          }, turn files back on, then run ${
            liked
              ? 'sync --export --confirm (the Web API does not list local files in Liked Songs, so the ' +
                'export cannot see them there)'
              : 'sync --export again'
          } (README.md has the checklist)`
      : 'stage/: empty, every song is in its playlists'
  );
  return { exported, counts, phone: await runPhone({ config, exported, dryRun, connect }) };
};

const runPlan = async ({
  client,
  config,
  push = false,
  pull = false,
  prune = false,
  exportFiles = false,
  confirmLiked = false,
  dryRun = false,
  confirm = confirmPrompt,
  switches = {}
}) => {
  const db = openSyncLibrary(config);
  try {
    // sync.ignorePlaylist is refreshed too, its tracks are left out of the pull list
    const playlistIds = _.compact([
      ..._.map(playlistTargets(config), 'id'),
      ignorePlaylistId(config)
    ]);
    await refreshCache(db, client, playlistIds, {
      onProgress: refreshProgress('Refreshing Spotify playlists')
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
      ? await runPush({
          db,
          client,
          config,
          plan,
          prune,
          dryRun,
          confirm,
          verbose: Boolean(switches.verbose)
        })
      : undefined;
    const pulled = pull ? await runPull({ config, plan, dryRun, confirm }) : undefined;
    const exported = exportFiles
      ? await runExport({ config, plan, dryRun, confirmLiked })
      : undefined;
    // what Spotify and the tags agree on now is the state the next sync compares with
    if (!dryRun) {
      recordSynced(db, syncPlan(db, config, songTargets(await librarySongs(config), config)));
    }
    return { plan, pushed, pulled, exported };
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
  const result = await acceptReview({
    db,
    config,
    client,
    items: accept,
    layouts: beetsLayouts(config)
  });
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
      const live = _.filter(rechecked, { reason: 'live' }).length;
      logger.info(
        `${rechecked.length} matches moved to review by the current title rule` +
          `${live ? ` (${live} a live song on a studio track or the other way round)` : ''}` +
          ` (sync --review)${dryRun ? ', dry run' : ''}`
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
      layouts: beetsLayouts(config),
      dryRun,
      refresh,
      // --recheck also looks matches on compilations up again for their original album
      releases: recheck,
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

// the sync --import progress line per phase (importDownloads onProgress); beets' progress is the count
// of downloads it moved out of the folder, so with copy instead of move only its elapsed time is shown
const importProgress = moves => {
  const started = {};
  return (phase, done, total) => {
    started[phase] = started[phase] || new Date();
    const startedAt = started[phase];
    if (phase === 'details') {
      logger.progress(`Fetching Spotify details for ${total} tracks`);
    } else if (phase === 'tagging') {
      logger.progress(progressBar({ done, total, label: 'Tagging', unit: 'files', startedAt }));
    } else if (moves) {
      logger.progress(
        progressBar({ done, total, label: 'Importing with beets', unit: 'files', startedAt })
      );
    } else {
      logger.progress(
        `Importing ${total} files with beets  ${dim(formatClock((new Date() - startedAt) / 1000))}`
      );
    }
  };
};

// downloads beets moved before an import was stopped: the database learns their library paths, then the
// manifest marks them imported and their undo history follows them (recoverImports)
const recoverInterrupted = async ({ config, manifest, beets }) => {
  const db = openSyncLibrary(config);
  try {
    const stale = staleDownloads(db, config);
    if (stale.length === 0) {
      return [];
    }
    await updateDatabase(db, {
      config,
      target: path.join(config.mpd.baseDirectory, unsortedFolder(beets))
    });
    const recovered = recoverImports({ db, config, manifest, stale });
    if (recovered.length > 0) {
      writeManifest(config, manifest);
      logger.info(
        `Finished ${recovered.length} downloads an interrupted import moved into the library ` +
          '(marked imported, undo history pointed at them)'
      );
    }
    return recovered;
  } finally {
    db.close();
  }
};

// tag downloads from the manifest with their Spotify fields and playlist tags, then import with beets
// the import's question: answered by --yes (musicman ui runs the import, without a terminal), else asked
const importConfirm = (switches, confirm) =>
  switches.yes ? async () => true : confirm || confirmPrompt;

const runImport = async ({ credentials, fetchImpl, config, dryRun, confirm }) => {
  const manifest = readManifest(config);
  if (!manifest) {
    throw new Error(`No manifest at ${manifestPath(config)}, run: musicman sync --pull`);
  }
  const beets = readBeetsConfig(config.sync.beetsConfig);
  if (!beets) {
    throw new Error(`No beets config at ${config.sync.beetsConfig} (sync.beetsConfig)`);
  }
  // a download writes into the directory the import reads: a file being written would be imported cut short
  const download = _.find(runningRuns(runsDirectory(config)), { command: 'download' });
  if (download && !dryRun) {
    throw new Error(
      `A download is running (pid ${download.pid}): import when it is done, or stop it first`
    );
  }
  if (!dryRun) {
    await recoverInterrupted({ config, manifest, beets });
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
      onFile: (status, item, detail) => {
        if (status === 'unknown') {
          logger.warn(`${label('SKIP', '#DD7744')} ${path.basename(item.file)}: ${detail}`);
          return;
        }
        const line = [
          label('TAG', '#55CC55'),
          `${item.entry.artists} - ${item.entry.name}`,
          chalk.hex('#55AA77')(`+${detail.custom.length} fields`),
          detail.filled.length > 0 && chalk.hex('#5599BB')(`~${detail.filled.length} filled`),
          dim(_.map(detail.playlist, ({ name, value }) => `${name}:${value}`).join(' '))
        ]
          .filter(Boolean)
          .join(' ');
        // a dry run lists what it would tag; a real import shows the progress bar and logs each file
        if (dryRun) {
          logger.info(line);
        } else {
          logger.logToFile('info', line);
        }
      },
      onProgress: importProgress(beets.move)
    });
    logger.progressDone();
    if (summary.detailsError) {
      logger.warn(
        `Spotify fields could not be fetched (${summary.detailsError}), the downloads got their ids ` +
          'and playlist tags; sync --match fills the fields later'
      );
    }
    let database = null;
    if (!dryRun) {
      writeManifest(config, manifest);
      const added = [];
      const databaseStart = new Date();
      database = await updateDatabase(db, {
        config,
        target: path.join(config.mpd.baseDirectory, unsortedFolder(beets)),
        onFile: (action, file) => action === 'added' && added.push(file),
        onProgress: ({ done, total }) =>
          logger.progress(
            progressBar({
              done,
              total,
              label: 'Updating the database',
              unit: 'files',
              startedAt: databaseStart
            })
          )
      });
      logger.progressDone();
      // the tags written to the downloads were recorded at their download paths; beets moved them
      const baseDirectory = path.resolve(config.mpd.baseDirectory);
      relinkHistory(db, importedMoves({ db, baseDirectory, files: summary.files, added }), {
        baseDirectory
      });
    }
    logger.info(
      formatImportSummary(summary, {
        dryRun,
        database,
        left: _.reject(_.get(manifest, 'tracks', []), 'importedAt').length,
        folder: unsortedFolder(beets)
      })
    );
    _.each(summary.skipped, file => logger.warn(`beets skipped ${file}`));
    if (!dryRun && summary.imported > 0 && _.get(config, 'sync.importLyrics', true) === false) {
      const folder = path.join(path.resolve(config.mpd.baseDirectory), unsortedFolder(beets));
      logger.info(
        `Lyrics were left out (sync.importLyrics: false), fetch them with: beet lyrics ${folder}`
      );
    }
    return { import: summary };
  } finally {
    // a failed beets run leaves no progress line behind
    logger.progressDone();
    if (db) {
      db.close();
    }
  }
};

// a few files of a backup plan category on the terminal, every one in the log
const listBackupFiles = (
  label,
  entries,
  color,
  describe = entry => `${entry.path} ${dim(formatSize(entry.size))}`
) => {
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
// Spotify track ids ReccoBeats did not know, by the day they were asked, skipped until --refresh
const featuresMissingKey = 'features.missing';

/**
 * sync --features: audio features from ReccoBeats for the songs with a Spotify id and none yet
 * (--refresh: all of them), written to their tags after a confirmation (--yes: without): tempo to
 * TBPM, key to TKEY, the rest to rb_<field>, as features.fields picks. Recorded for musicman undo.
 */
const runFeatures = async ({ config, dryRun, refresh, confirm, fetchImpl = fetch }) => {
  const fields = _.get(config, 'features.fields') || featureFields;
  const db = openSyncLibrary(config);
  try {
    const missing = getMeta(db, featuresMissingKey) || {};
    const songs = songsForFeatures(db, { refresh, missing: new Set(_.keys(missing)) });
    const skipped = refresh ? 0 : _.size(missing);
    logger.info(
      `${songs.length} songs to look up on ReccoBeats${
        skipped ? ` (${skipped} it did not know before are skipped, --refresh asks again)` : ''
      }`
    );
    if (songs.length === 0) {
      return { features: { songs: 0 } };
    }
    const startedAt = new Date();
    const found = await fetchFeatures(_.map(songs, 'trackId'), {
      fetchImpl,
      onBatch: (done, total) =>
        logger.progress(progressBar({ done, total, startedAt, label: 'Looking up' }))
    });
    logger.progressDone();
    const known = _.filter(songs, ({ trackId }) => found.has(trackId));
    const unknown = _.reject(songs, ({ trackId }) => found.has(trackId));
    logger.info(`ReccoBeats knows ${known.length} of them, not ${unknown.length}`);
    if (dryRun || known.length === 0) {
      return { features: { songs: songs.length, found: known.length, written: 0, dryRun } };
    }
    if (
      !(await confirm(`Write the audio features (${fields.join(', ')}) to ${known.length} songs?`))
    ) {
      logger.info('Features cancelled');
      return { features: { songs: songs.length, found: known.length, written: 0 } };
    }
    const baseDirectory = path.resolve(config.mpd.baseDirectory);
    const written = [];
    const failed = [];
    const now = new Date();
    known.forEach(({ path: songPath, trackId }, i) => {
      const file = path.join(baseDirectory, songPath);
      const { custom, standard } = featureWrites(found.get(trackId), fields, now);
      const result = updateTags(
        {
          userDefinedText: _.map(custom, ({ name, value }) => ({ description: name, value })),
          ...standard
        },
        file
      );
      if (result instanceof Error) {
        failed.push({ file: songPath, error: result.message });
      } else {
        written.push(file);
      }
      logger.progress(
        progressBar({ done: i + 1, total: known.length, startedAt: now, label: 'Writing' })
      );
    });
    logger.progressDone();
    if (written.length > 0) {
      await updateDatabase(db, { config, files: written });
    }
    const day = now.toISOString().slice(0, 10);
    setMeta(db, featuresMissingKey, {
      ...(refresh ? {} : missing),
      ..._.fromPairs(_.map(unknown, ({ trackId }) => [trackId, day]))
    });
    failed.forEach(({ file, error }) => logger.warn(`FAILED  ${file}: ${error}`));
    logger.info(
      `Wrote the audio features of ${written.length} songs${failed.length ? `, ${failed.length} failed` : ''}`
    );
    return {
      features: { songs: songs.length, found: known.length, written: written.length, failed }
    };
  } finally {
    db.close();
  }
};

const runBackup = async ({ config, dryRun, force = false, confirm }) => {
  const directory = _.get(config, 'backup.directory');
  const keepReplaced = _.get(config, 'backup.keepReplaced', defaultKeepReplaced);
  const keepRemovedDays = _.get(config, 'backup.keepRemovedDays', defaultKeepRemovedDays);
  if (!directory) {
    throw new Error('Set backup.directory in the config to the folder to back up to');
  }
  if (!fs.existsSync(directory)) {
    throw new Error(`Backup directory ${directory} does not exist (is the share mounted?)`);
  }
  const source = path.resolve(config.mpd.baseDirectory);
  logger.info(`Comparing ${source} with ${directory}`);
  const comparingStarted = new Date();
  const listed = { library: 0, backup: 0 };
  const planned = backupPlan({
    source,
    directory,
    exclude: _.get(config, 'backup.exclude', []),
    onProgress: ({ phase, side, count, done, total }) => {
      if (phase === 'list') {
        listed[side] = count;
        logger.progress(
          `${chalk.hex('#8888FF').bold('Listing')} ${listed.library} library files, ` +
            `${listed.backup} backup files  ${dim(formatClock((new Date() - comparingStarted) / 1000))}`
        );
      } else {
        logger.progress(
          progressBar({
            done,
            total,
            startedAt: comparingStarted,
            label: 'Comparing',
            unit: 'files'
          })
        );
      }
    }
  });
  logger.progressDone();
  // --force takes the library version of held files too
  const plan = force
    ? { ...planned, update: [...planned.update, ...planned.held], held: [] }
    : planned;
  if (force && planned.held.length > 0) {
    listBackupFiles(
      'FORCE',
      planned.held,
      backupColors.held,
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
  listBackupFiles('COPY', plan.copy, backupColors.copy);
  listBackupFiles('UPDATE', plan.update, backupColors.update);
  listBackupFiles(
    'HOLD',
    plan.held,
    backupColors.held,
    entry => `${entry.path} (backup has ${entry.frames.join(', ')})`
  );
  listBackupFiles(
    'RENAME',
    plan.rename,
    backupColors.rename,
    ({ from, to }) => `${from} -> ${path.basename(to)}`
  );
  listBackupFiles('MOVE', plan.remove, backupColors.remove);
  logger.info(formatBackupSummary(plan, { directory, dryRun, removedFolder }));
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
    `${plan.remove.length ? `, and move ${plan.remove.length} files only in the backup to ${removedFolder}/` : ''}` +
    `${plan.update.length && keepReplaced > 0 ? ` (the copies updates replace go to ${replacedFolder}/, the last ${keepReplaced} backups kept)` : ''}?`;
  if (!(await confirm(message))) {
    logger.info('Backup cancelled');
    return { backup: { plan: summary, applied: null } };
  }
  const total = plan.copy.length + plan.update.length;
  const mb = 1024 ** 2;
  const totalMb = Math.ceil(_.sumBy([...plan.copy, ...plan.update], 'size') / mb);
  const startedAt = new Date();
  let done = 0;
  let bytes = 0;
  const applied = applyBackup(plan, {
    keepReplaced,
    keepRemovedDays,
    onFile: (action, entry) => {
      logger.logToFile('debug', `${action} ${entry.path}`);
      if (action === 'copy' || action === 'update') {
        done += 1;
        bytes += entry.size;
        // by size, so the rate and ETA follow the bytes copied rather than the file count
        logger.progress(
          progressBar({
            done: Math.round(bytes / mb),
            total: totalMb,
            startedAt,
            label: 'Backing up',
            unit: 'MB',
            detail: dim(`${done}/${total} files`)
          })
        );
      }
    }
  });
  logger.progressDone();
  logger.info(
    `Backed up ${applied.copied + applied.updated} files (${formatSize(applied.bytes)})` +
      `${applied.renamed ? `, renamed ${applied.renamed} to the library's capitalization` : ''}` +
      `${applied.moved ? `, moved ${applied.moved} to ${applied.removedTo}` : ''}` +
      `${applied.replaced ? `, kept ${applied.replaced} replaced copies in ${applied.replacedTo}` : ''}` +
      `${applied.prunedReplaced ? ` (deleted the ${applied.prunedReplaced} oldest runs of them)` : ''}` +
      `${applied.prunedRemoved ? `; deleted ${applied.prunedRemoved} folders of removed files older than ${keepRemovedDays} days` : ''}`
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
        items: picked,
        layouts: beetsLayouts(config)
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
    if (switches.features) {
      return await runFeatures({
        config,
        dryRun: Boolean(switches.dryRun),
        refresh: Boolean(switches.refresh),
        confirm: importConfirm(switches, confirm),
        fetchImpl: fetchImpl || fetch
      });
    }
    if (switches.import) {
      return await runImport({
        credentials,
        fetchImpl,
        config,
        dryRun: Boolean(switches.dryRun),
        confirm: importConfirm(switches, confirm)
      });
    }
    if (switches.review) {
      return await runReview({ config, switches, credentials, fetchImpl, pick });
    }
    if (switches.confirm && !switches.export) {
      throw new Error('--confirm goes with --export: sync --export --confirm');
    }
    const status = await showStatus({ credentials, file, fetchImpl, env, config });
    if (!status.loggedIn) {
      return status;
    }
    const { plan, pushed, pulled, exported } = await runPlan({
      client: status.client,
      config,
      push: Boolean(switches.push),
      pull: Boolean(switches.pull),
      prune: Boolean(switches.prune),
      exportFiles: Boolean(switches.export),
      confirmLiked: Boolean(switches.confirm),
      dryRun: Boolean(switches.dryRun),
      confirm,
      switches
    });
    return { ..._.omit(status, 'client'), plan, pushed, pulled, exported };
  } catch (err) {
    logger.error(err.message);
    logger.logToFile('error', err.stack);
    process.exitCode = 1;
    return false;
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  importConfirm,
  name: 'sync',
  description: 'Sync Liked Songs and playlists with Spotify; without switches, show the plan',
  usage:
    'musicman sync [--login | --match [--refresh] [--recheck] [--verbose] | --review [--accept | --reject] | --push [--prune] | --pull | --export [--confirm] | --import [--yes] | --features [--refresh] [--yes] | --backup [--force]] [--dry-run]',
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
    'export',
    'confirm',
    'import',
    'features',
    'yes',
    'backup',
    'force',
    'dry-run',
    'format',
    'fzf'
  ],
  switchHelp: {
    refresh:
      'With --match, fetch the Spotify fields of every matched song again; with --features, fetch the audio features of every song with a Spotify id',
    yes: 'Answer yes to the question of --import (musicman ui runs it, without a terminal) or --features',
    backup: 'Mirror the library files to backup.directory after confirming',
    force:
      'With --backup, also update backup files held back because their copy has frames the library copy lacks',
    'dry-run':
      'Show what would change without writing files or Spotify (--match still caches its lookups)'
  },
  func: syncCommand,
  withoutIdsMessage,
  // reviewing only lists, accepting or rejecting changes tags
  archive: ({ review, accept, reject }) => !review || Boolean(accept || reject),
  defaultTarget,
  targetArgs: false,
  terms: false
};
