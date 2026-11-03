const _ = require('lodash');
const fs = require('fs');
const readline = require('readline');
const { execFile: nodeExecFile, spawn: nodeSpawn } = require('child_process');

const { connectMpd } = require('../clients/mpd.js');
const { coverFor } = require('../menu/cover.js');
const { chipColors, defaultChip, stars, tones } = require('../menu/menu.js');
const { escapeMarkup } = require('../menu/rofi.js');
const { libraryFileForPlaying } = require('../player/library.js');
const logger = require('../utils/logger.js');

// fields shown as tags when daemon.fields is not set
const defaultFields = ['context', 'mood', 'picks'];

// time for Spotify to report the whole new track after the first metadata change
const spotifySettleMs = 300;

// waits before reconnecting to MPD after the connection drops: doubled each failure up to the last
const reconnectMs = [1000, 2000, 5000, 10000, 30000];

// wait before starting playerctl again after it exits
const playerctlRestartMs = 5000;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// the values of a field, multi value fields split on commas, empty items dropped
const valuesOf = value => _.compact(_.map(`${_.isNil(value) ? '' : value}`.split(','), _.trim));

// what identifies a track per player: a new key is a new track
const trackKey = (source, track) =>
  track ? `${source}:${track.trackId || track.file || `${track.artist}-${track.title}`}` : null;

/**
 * The command and arguments that show a song notification: the rating as stars and the title as the
 * summary, the artist and album, then each of daemon.fields as colored tags, as the body (Pango markup).
 * The app name is the player; the icon the cover when daemon.icon is on. replaceId replaces the last
 * notification, and --print-id reports the id of this one.
 */
const buildNotification = (notice, { bin, icon = true, duration, urgency, fields }, replaceId) => {
  const rating = notice.rating ? `${stars(notice.rating)}  ` : '';
  const shown = fields || defaultFields;
  const tags = _.flatMap(shown, field =>
    _.map(valuesOf(notice.meta && notice.meta[field]), value => {
      const [foreground, background] = chipColors[field] || defaultChip;
      return `<span foreground="${foreground}" background="${background}"> ${escapeMarkup(
        value
      )} </span>`;
    })
  );
  const body = _.compact([
    _.compact([
      notice.artist && `<b>${escapeMarkup(notice.artist)}</b>`,
      notice.album && escapeMarkup(notice.album)
    ]).join('  ·  '),
    notice.inLibrary
      ? notice.rating
        ? null
        : `<span foreground="${tones.ignore}">unrated</span>`
      : `<span foreground="${tones.ignore}"><i>not in library</i></span>`,
    tags.length ? tags.join(' ') : null
  ]).join('\n');
  const args = [
    `--urgency=${_.toLower(urgency || 'low')}`,
    `--expire-time=${duration}`,
    `--app-name=${notice.source}`,
    '--print-id',
    ...(replaceId ? [`--replace-id=${replaceId}`] : []),
    ...(icon && notice.cover ? [`--icon=${notice.cover}`] : []),
    `${rating}${notice.title || ''}`,
    body
  ];
  return { bin, args };
};

/**
 * What a notification shows for a player's track: the track, and for a song in the library (MPD's file,
 * the one linked to the Spotify track, or the one a Spotify local file was made from) its tags and rating; the cover of either.
 * Dependencies: openDb() the library database or null without one, readSong(file) its parsed tags.
 */
const songNotice = async ({ player, track }, { config, openDb, readSong, cover = coverFor }) => {
  let file = player.source === 'mpd' ? track.file : null;
  if (!file && (track.trackId || track.local)) {
    const db = openDb();
    if (db) {
      try {
        file = libraryFileForPlaying(db, config, player, track);
      } finally {
        db.close();
      }
    }
  }
  const meta = file ? (await readSong(file)) || null : null;
  return {
    source: player.name,
    title: track.title,
    artist: track.artist,
    album: track.album,
    rating: meta && meta.rating ? meta.rating : null,
    inLibrary: Boolean(meta),
    meta,
    cover: await cover(track, { file }).catch(() => null)
  };
};

/**
 * Notifies about track changes: check(player) reads the player's state and, when it is playing a track
 * other than the last one notified for that player, sends a notification that replaces the previous one
 * (any player's). Pausing, seeking, or a track starting again changes nothing.
 * Dependencies: describe(context) builds the notice (songNotice), send(notice, replaceId) shows it and
 * resolves to its id.
 */
const createNotifier = ({ describe, send, onTrack = null }) => {
  const last = {};
  let replaceId = null;
  let queue = Promise.resolve();
  const check = async player => {
    const status = await player.state();
    const key = trackKey(player.source, status.track);
    if (status.state !== 'playing' || !key || last[player.source] === key) {
      return null;
    }
    last[player.source] = key;
    if (onTrack) {
      // what else follows the songs (the shuffle handoff); its failure never stops the notification
      await Promise.resolve(onTrack({ player, status })).catch(err =>
        logger.error(`After the song change in ${player.name}: ${err.message}`)
      );
    }
    const notice = await describe({ player, track: status.track });
    replaceId = (await send(notice, replaceId)) || replaceId;
    return notice;
  };
  return {
    // checks run one at a time, so two events for one track never notify twice
    check: player => {
      queue = queue
        .then(() => check(player))
        .catch(err => {
          logger.error(`Song notification for ${player.name} failed: ${err.message}`);
          return null;
        });
      return queue;
    }
  };
};

/**
 * Shows a notice with the daemon config; resolves to the notification id notify-send prints, or null.
 * Arguments go to the binary directly, so song metadata is never interpreted by a shell; a failure is
 * logged, not thrown.
 */
const sendNotification = (notice, daemonConfig, replaceId, { execFile = nodeExecFile } = {}) => {
  const { bin, args } = buildNotification(notice, daemonConfig, replaceId);
  logger.debug(['Sending notification:', ...args].join('\n\t'));
  return new Promise(resolve =>
    execFile(bin, args, (err, stdout) => {
      if (err) {
        logger.error(`Failed to send notification: ${err.message}`);
        resolve(null);
        return;
      }
      resolve(_.trim(stdout) || null);
    })
  );
};

/**
 * Calls onChange on each MPD player event (song change, play, pause) over an idle connection,
 * reconnecting with growing waits when MPD is unreachable or the connection drops. Resolves to stop().
 */
const watchMpd = async (
  mpdConfig,
  onChange,
  { connect = connectMpd, waits = reconnectMs } = {}
) => {
  let stopped = false;
  let client = null;
  let failures = 0;
  const run = async () => {
    while (!stopped) {
      try {
        client = await connect(mpdConfig);
        failures = 0;
        logger.info(`Watching MPD at ${mpdConfig.host}:${mpdConfig.port}`);
        onChange();
        await new Promise(resolve => {
          client.on('system', name => name === 'player' && onChange());
          client.on('error', resolve);
          client.on('end', resolve);
          if (client.socket) {
            client.socket.on('close', resolve);
          }
        });
        if (!stopped) {
          logger.warn('MPD connection closed, reconnecting');
        }
      } catch (err) {
        if (failures === 0) {
          logger.warn(`MPD is not available (${err.message}), retrying`);
        }
        failures += 1;
      }
      if (!stopped) {
        await wait(waits[Math.min(Math.max(failures - 1, 0), waits.length - 1)]);
      }
    }
  };
  const running = run();
  return async () => {
    stopped = true;
    if (client && client.socket) {
      client.socket.destroy();
    }
    await running;
  };
};

/**
 * Calls onChange each time the Spotify desktop app reports new metadata (MPRIS PropertiesChanged, through
 * playerctl --follow), after a short wait for the rest of it. playerctl keeps running while Spotify is
 * closed and reopened; it is started again if it exits. Returns stop().
 */
const watchSpotify = (
  onChange,
  { spawn = nodeSpawn, settle = spotifySettleMs, restart = playerctlRestartMs } = {}
) => {
  let stopped = false;
  let child = null;
  let timer = null;
  const start = () => {
    child = spawn(
      'playerctl',
      ['-p', 'spotify', '--follow', 'metadata', '--format', '{{xesam:url}}'],
      {
        stdio: ['ignore', 'pipe', 'ignore']
      }
    );
    readline.createInterface({ input: child.stdout }).on('line', line => {
      if (_.trim(line)) {
        clearTimeout(timer);
        timer = setTimeout(onChange, settle);
      }
    });
    child.on('error', err => {
      logger.error(
        err.code === 'ENOENT'
          ? 'playerctl is not installed, Spotify songs are not notified'
          : `playerctl failed: ${err.message}`
      );
    });
    child.on('close', code => {
      if (stopped || code === null) {
        return;
      }
      setTimeout(() => !stopped && start(), restart);
    });
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (child) {
      child.kill();
    }
  };
};

/**
 * Notifies about each new track MPD or the Spotify desktop app plays, starting with the ones playing now.
 * Dependencies: players { mpd, spotify } (player objects with state()), openDb, readSong, and the
 * watchers, notify-send runner and cover lookup for tests.
 */
const watchSongs = async (
  config,
  {
    players,
    openDb,
    readSong,
    send = (notice, replaceId) => sendNotification(notice, config.daemon, replaceId),
    cover,
    onTrack = null,
    mpdWatcher = watchMpd,
    spotifyWatcher = watchSpotify
  }
) => {
  const notifier = createNotifier({
    describe: context => songNotice(context, { config, openDb, readSong, cover }),
    send,
    onTrack
  });
  const stopSpotify = spotifyWatcher(() => notifier.check(players.spotify));
  notifier.check(players.spotify);
  const stopMpd = await mpdWatcher(config.mpd, () => notifier.check(players.mpd));
  return async () => {
    stopSpotify();
    await stopMpd();
  };
};

// the library database when there is one, for the daemon's lookups of Spotify tracks
const libraryDb = (config, openLibrary) => () =>
  fs.existsSync(config.db.path) ? openLibrary(config) : null;

module.exports = {
  buildNotification,
  createNotifier,
  defaultFields,
  libraryDb,
  sendNotification,
  songNotice,
  trackKey,
  watchMpd,
  watchSongs,
  watchSpotify
};
