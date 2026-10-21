const _ = require('lodash');
const chalk = require('chalk').default;
const fs = require('fs');

const Confirm = require('prompt-confirm');
const { createClient } = require('../spotify/api.js');
const { appTokenGetter, readTokens, userAccessToken } = require('../spotify/auth.js');
const { getCredentials, missingCredentials, tokenPath } = require('../spotify/credentials.js');
const { login } = require('../spotify/login.js');
const { readBeetsSpotifyIds } = require('../spotify/beets.js');
const { matchSongs, reviewItems, spotifyIdFrame } = require('../sync/match.js');
const { playlistTargets, songTargets } = require('../sync/targets.js');
const { refreshCache } = require('../sync/cache.js');
const { syncPlan } = require('../sync/plan.js');
const { pushPlan } = require('../sync/push.js');
const { buildManifest, writeManifest } = require('../sync/pull.js');
const { renderColumns } = require('../output/render.js');
const { progressBar } = require('../output/progress.js');
const { formatSongResult, formatUnassigned } = require('../output/sync.js');
const { dim, emitFormatted } = require('../output/emit.js');
const { outputFormat } = require('../output/formats.js');
const { previewCommand } = require('../output/fzf.js');
const { backupIfDue, openLibrary } = require('../db/index.js');
const { getFilteredFiles } = require('./common.js');
const logger = require('../utils/logger.js');

const credentialSource = (env, name) => (env[name] ? 'environment' : 'config');

const userClient = ({ credentials, file, fetchImpl }) =>
  createClient({ getToken: () => userAccessToken({ credentials, file, fetchImpl }), fetchImpl });

const runLogin = async ({ credentials, file, fetchImpl, open }) => {
  await login({
    credentials,
    file,
    fetchImpl,
    open,
    onUrl: url => logger.info(`Log in to Spotify in the browser (opening it now): ${url}`)
  });
  // the login is complete once the token is saved, looking up the user is only informational
  try {
    const me = await userClient({ credentials, file, fetchImpl }).get('/me');
    logger.info(`Logged in to Spotify as ${me.display_name || me.id}, token saved to ${file}`);
    return { user: me.id };
  } catch (err) {
    logger.warn(
      `Logged in to Spotify, token saved to ${file}; could not look up the user: ${err.message}`
    );
    return { user: null };
  }
};

const showStatus = async ({ credentials, file, fetchImpl, env }) => {
  logger.info(
    `Spotify app: client id from ${credentialSource(env, 'SPOTIFY_CLIENT_ID')}, redirect ${
      credentials.redirectUri
    }`
  );
  if (!readTokens(file)) {
    logger.info('Not logged in, run: musicman sync --login');
    return { loggedIn: false };
  }
  const client = userClient({ credentials, file, fetchImpl });
  const me = await client.get('/me');
  logger.info(`Logged in as ${me.display_name || me.id}`);
  return { loggedIn: true, user: me.id, client };
};

// refresh the cache of Liked Songs and mapped playlists, then report what sync would change
const confirmPrompt = message => new Confirm({ message }).run();

// apply the plan after confirming, then refresh the cache of the targets that changed
const runPush = async ({ db, client, config, plan, prune, dryRun, confirm }) => {
  const total = key => _.sumBy(plan, target => target[key].length);
  const adds = total('add');
  const removes = prune ? total('prune') : 0;
  if (adds + removes === 0) {
    logger.info('Nothing to push');
    return [];
  }
  const message = `Add ${adds} tracks${
    prune ? ` and remove ${removes} tracks` : ''
  } across Liked Songs and playlists?`;
  if (dryRun) {
    logger.info(`Dry run: would ${message.charAt(0).toLowerCase()}${message.slice(1, -1)}`);
    return [];
  }
  if (!(await confirm(message))) {
    logger.info('Push cancelled');
    return [];
  }
  const results = await pushPlan(client, plan, {
    prune,
    onTarget: ({ name, added, removed }) =>
      (added || removed) &&
      logger.info(`${name}: added ${added}${prune ? `, removed ${removed}` : ''}`)
  });
  const changed = _.map(
    _.filter(results, ({ added, removed }) => added || removed),
    'id'
  );
  await refreshCache(db, client, _.without(changed, 'liked'));
  return results;
};

// write the download manifest for tracks that are only on Spotify
const runPull = ({ config, plan, dryRun }) => {
  const manifest = buildManifest(plan, config);
  const withoutIds = _.sumBy(plan, target => target.noId.length);
  if (withoutIds > 0) {
    logger.warn(
      `${withoutIds} songs have no Spotify id yet, so the manifest may list songs you already have (run sync --match first)`
    );
  }
  if (dryRun) {
    logger.info(`Dry run: would write ${manifest.tracks.length} tracks to the download manifest`);
    return { manifest };
  }
  const file = writeManifest(config, manifest);
  logger.info(`Wrote ${manifest.tracks.length} tracks to download to ${file}`);
  return { manifest, file };
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
    if (outputFormat(switches) !== 'default') {
      emitFormatted({
        switches,
        config,
        title: 'musicman sync plan',
        records: _.map(plan, target => ({
          target: target.name,
          spotify: target.remote,
          local: target.local,
          add: target.add.length,
          noId: target.noId.length,
          prune: target.prune.length,
          pull: target.pull.length
        })),
        columns: ['target', 'spotify', 'local', 'add', 'noId', 'prune', 'pull'],
        oneline: record =>
          `${record.target}\t${chalk.bold(record.target)} ${dim(
            `spotify ${record.spotify}, local ${record.local}`
          )} add ${record.add}, no id ${record.noId}, prune ${record.prune}, pull ${record.pull}`
      });
    }
    const rows = _.map(plan, target =>
      [
        target.name,
        target.remote,
        target.local,
        target.add.length,
        target.noId.length,
        target.prune.length,
        target.pull.length
      ].map(String)
    );
    const head = ['Target', 'Spotify', 'Local', 'Add', 'No id', 'Prune', 'Pull'];
    const columns = [{ maxWidth: 40 }, ...Array(6).fill({ align: 'right' })];
    if (outputFormat(switches) === 'default') {
      logger.info(`\n${renderColumns({ head, rows, columns, splitter: '  ' })}`);
    }
    const total = key => _.sumBy(plan, target => target[key].length);
    logger.info(
      `To add: ${total('add')}, without a Spotify id: ${total('noId')} (sync --match), ` +
        `to prune: ${total('prune')}, to pull: ${total('pull')}`
    );
    const pushed = push
      ? await runPush({ db, client, config, plan, prune, dryRun, confirm })
      : undefined;
    const pulled = pull ? runPull({ config, plan, dryRun }) : undefined;
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

const runMatch = async ({ credentials, file, fetchImpl, config, dryRun, refresh }) => {
  const db = openSyncLibrary(config);
  try {
    const backup = dryRun ? null : backupIfDue(db, config);
    if (backup) {
      logger.info(`Backed up database to ${backup.file}`);
    }
    const songs = songTargets(await librarySongs(config), config);
    const startedAt = new Date();
    const summary = await matchSongs({
      db,
      config,
      songs,
      // lookups need no user, the app token avoids the user-read-private scope a market would need
      client: createClient({ getToken: appTokenGetter(credentials, { fetchImpl }), fetchImpl }),
      beetsIds: readBeetsSpotifyIds(config.sync.beetsConfig),
      dryRun,
      refresh,
      onProgress: ({ done, total, match, refresh: refreshed, review, missing, failed }) =>
        logger.progress(
          progressBar({
            done,
            total,
            startedAt,
            detail: `${match} matched, ${refreshed} refreshed, ${review} review, ${missing} missing, ${failed} failed`
          })
        ),
      onSong: (status, item, result) =>
        logger[status === 'failed' ? 'warn' : 'info'](formatSongResult(status, item, result))
    });
    logger.progressDone();
    const { bySource } = summary;
    logger.info(
      [
        `Spotify ids ${dryRun ? '(dry run, nothing written)' : ''}`.trim(),
        `  songs for Liked Songs or playlists: ${summary.targets}`,
        `  already tagged: ${summary.tagged}, recently checked: ${summary.cached}`,
        `  not in database: ${summary.notInDatabase} (run musicman db --update)`,
        `  matched: ${summary.match} (beets ${bySource.beets}, isrc ${bySource.isrc}, search ${bySource.search})`,
        `  fields refreshed: ${summary.refresh}`,
        `  to review: ${summary.review} (musicman sync --review)`,
        `  not found: ${summary.missing}, failed: ${summary.failed}`
      ].join('\n')
    );
    if (!_.isEmpty(summary.unassigned)) {
      logger.warn(
        `Spotify returned fields that are not written, add them to spotify.fields or spotify.ignore:\n${formatUnassigned(
          summary.unassigned
        )}`
      );
    }
    return { summary };
  } finally {
    db.close();
  }
};

const runReview = ({ config, switches = {} }) => {
  const db = openSyncLibrary(config);
  try {
    const items = reviewItems(db, config);
    if (outputFormat(switches) !== 'default') {
      const { selected } = emitFormatted({
        switches,
        config,
        title: 'musicman sync review',
        records: _.map(items, ({ file: songFile, duration, candidate }) => ({
          path: songFile,
          duration,
          spotifyId: candidate.id,
          spotifyArtists: candidate.artists,
          spotifyName: candidate.name,
          spotifyAlbum: candidate.album,
          spotifyDuration: candidate.durationMs / 1000
        })),
        oneline: record =>
          `${record.path}\t${record.path} ${dim('->')} ${record.spotifyArtists} - ${
            record.spotifyName
          } ${dim(`[${record.spotifyAlbum}] ${formatDuration(record.duration)} vs ${formatDuration(record.spotifyDuration)}`)}`,
        preview: previewCommand('view')
      });
      return { review: items, selected };
    }
    // edit assigns tags by their library.tags name
    const tagName = _.get(_.find(config.library.tags, { id: spotifyIdFrame }), 'name');
    const accept = (songFile, id) =>
      tagName
        ? `  accept: musicman edit "${songFile}" ${tagName}=${id}`
        : `  accept: add a ${spotifyIdFrame} tag to library.tags, then edit it to ${id}`;
    if (items.length === 0) {
      logger.info('No Spotify matches waiting for review');
    }
    items.forEach(({ file: songFile, path: songPath, duration, candidate }) =>
      logger.info(
        [
          `${songPath} (${formatDuration(duration)})`,
          `  Spotify: ${candidate.artists} - ${candidate.name} [${
            candidate.album
          }] (${formatDuration(candidate.durationMs / 1000)})`,
          accept(songFile, candidate.id)
        ].join('\n')
      )
    );
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
      return await runLogin({ credentials, file, fetchImpl, open });
    }
    if (switches.match) {
      return await runMatch({
        credentials,
        file,
        fetchImpl,
        config,
        dryRun: Boolean(switches.dryRun),
        refresh: Boolean(switches.refresh)
      });
    }
    if (switches.review) {
      return runReview({ config, switches });
    }
    const status = await showStatus({ credentials, file, fetchImpl, env });
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
    process.exitCode = 1;
    return false;
  }
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'sync',
  description: 'Sync Liked Songs and playlists with Spotify; without switches, show the plan',
  usage:
    'musicman sync [--login | --match [--refresh] | --review | --push [--prune] | --pull] [--dry-run]',
  switches: [
    'login',
    'match',
    'refresh',
    'review',
    'push',
    'prune',
    'pull',
    'dry-run',
    'format',
    'fzf'
  ],
  func: syncCommand,
  archive: ({ review }) => !review,
  defaultTarget,
  targetArgs: false
};
