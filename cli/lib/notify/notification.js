const _ = require('lodash');
const fs = require('fs');
const readline = require('readline');
const { execFile: nodeExecFile, spawn: nodeSpawn } = require('child_process');

const { connectMpd } = require('../clients/mpd.js');
const { coverFor } = require('../menu/cover.js');
const { chipColors, defaultChip, tones } = require('../menu/menu.js');
const { escapeMarkup } = require('../menu/rofi.js');
const { shownAlbum } = require('../status/album.js');
const { barSettings, glyphs, starLook } = require('../status/bar.js');
const { spotifyMprisNames } = require('../player/players.js');
const logger = require('../utils/logger.js');
const { isHearted, likeFacts } = require('./liked.js');

// fields shown as tags when daemon.fields is not set
const defaultFields = ['context', 'mood', 'picks'];

// the app name notification daemons see (rules match on it); the player goes in the x-musicman-player hint
const appName = 'musicman';

// the hint notifyd draws at the right end of the title line
const titleEndHint = 'x-notifyd-title-end';

// how long a notification waits for Spotify's word on Liked Songs before it goes with the cached one
const likedWaitMs = 1000;

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

// Pango markup of a glyph in a color
const colored = (color, text) => `<span foreground="${escapeMarkup(color)}">${text}</span>`;

/**
 * What goes right of the title (Pango markup, for notifyd's x-notifyd-title-end hint), drawn as the bar
 * draws it (status/bar.js, with its colors): the heart when the song is in Liked Songs, then the library
 * star and the rating. Songs outside the library have no star and unrated ones no number (the body says
 * so); '' when there is nothing to show.
 */
const titleEnd = (notice, colors = barSettings({}).colors) => {
  const star = starLook(notice, colors);
  const value = Number(notice.rating);
  return _.compact([
    notice.liked ? colored(colors.heart, glyphs.heart) : null,
    star ? colored(...star) : null,
    star && value ? value.toFixed(1) : null
  ]).join(' ');
};

/**
 * The command and arguments that show a song notification: the title as the summary, with the heart,
 * star and rating right of it (titleEnd, in notifyd's x-notifyd-title-end hint, which other daemons
 * leave out), and as the body (Pango markup) the artist and album, then each of daemon.fields as colored
 * tags. The app name is musicman and the player (mpd, spotify) goes in the x-musicman-player hint, so
 * daemon rules can match songs; daemon.duration, when set, asks for a display time (else the daemon
 * decides). The cover, when daemon.icon is on, goes in the image-path hint, which daemons show as the
 * notification's image (--icon is only the small app icon). replaceId replaces the last notification,
 * and --print-id reports the id of this one. colors are the bar's (barSettings).
 */
const buildNotification = (
  notice,
  { bin, icon = true, duration, urgency, fields },
  replaceId,
  colors = undefined
) => {
  const end = titleEnd(notice, colors);
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
    ...(_.isNil(duration) ? [] : [`--expire-time=${duration}`]),
    `--app-name=${appName}`,
    '--print-id',
    ...(replaceId ? [`--replace-id=${replaceId}`] : []),
    ...(notice.player ? [`--hint=string:x-musicman-player:${notice.player}`] : []),
    ...(end ? [`--hint=string:${titleEndHint}:${end}`] : []),
    ...(icon && notice.cover ? [`--hint=string:image-path:file://${notice.cover}`] : []),
    notice.title || '',
    body
  ];
  return { bin, args };
};

// ask(trackId)'s answer when it comes within ms, else null (no usable answer, a failure, too slow)
const answerWithin = (ask, trackId, ms) =>
  new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    Promise.resolve()
      .then(() => ask(trackId))
      .then(
        answer => resolve(_.isBoolean(answer) ? answer : null),
        () => resolve(null)
      )
      .finally(() => clearTimeout(timer));
  });

/**
 * What a notification shows for a player's track: the track, and for a song in the library (MPD's file,
 * the one linked to the Spotify track, or the one a Spotify local file was made from) its tags and
 * rating; the cover of either; and whether it is in Liked Songs, decided as the bar decides it
 * (notify/liked.js), from Spotify's answer when it comes within likedWait ms, else the cached Liked Songs.
 * Dependencies: openDb() the library database or null without one, readSong(file) its parsed tags,
 * liked(trackId) Spotify's answer (optional; the daemon shares it with the bar), likes the local likes
 * (optional), and for tests confirmedLiked(file).
 */
const songNotice = async (
  { player, track },
  {
    config,
    openDb,
    readSong,
    cover = coverFor,
    liked = null,
    likes = null,
    confirmedLiked = undefined,
    likedWait = likedWaitMs
  }
) => {
  const context = { player, track };
  let facts = likeFacts(null, config, context, { confirmedLiked });
  const db = openDb();
  if (db) {
    try {
      facts = likeFacts(db, config, context, { confirmedLiked });
    } finally {
      db.close();
    }
  }
  const { file } = facts;
  const [meta, answer, art] = await Promise.all([
    file ? Promise.resolve(readSong(file)).then(read => read || null) : null,
    liked && facts.trackId ? answerWithin(liked, facts.trackId, likedWait) : null,
    Promise.resolve()
      .then(() => cover(track, { file }))
      .catch(() => null)
  ]);
  return {
    source: player.name,
    player: player.source,
    title: track.title,
    artist: track.artist,
    album: shownAlbum(config, { source: player.source, file, meta, album: track.album }),
    rating: meta && meta.rating ? meta.rating : null,
    inLibrary: Boolean(meta),
    liked: isHearted(_.isBoolean(answer) ? { ...facts, catalogLiked: answer } : facts, likes),
    meta,
    cover: art
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
const sendNotification = (
  notice,
  daemonConfig,
  replaceId,
  { execFile = nodeExecFile, colors = undefined } = {}
) => {
  const { bin, args } = buildNotification(notice, daemonConfig, replaceId, colors);
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
 * Calls onChange each time Spotify on this computer (the desktop app, Soloist or spotifyd) reports new metadata or
 * a play state (MPRIS PropertiesChanged, through playerctl -a --follow), after a short wait for the rest
 * of it. playerctl keeps running while they are closed and reopened; it is started again if it exits.
 * Returns stop().
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
      [
        '-a',
        '-p',
        spotifyMprisNames.join(','),
        '--follow',
        'metadata',
        '--format',
        '{{playerName}} {{status}} {{xesam:url}}'
      ],
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
 * Dependencies: players { mpd, spotify } (player objects with state()), openDb, readSong, liked and likes
 * for the heart (songNotice), and the watchers, notify-send runner and cover lookup for tests. onEvent
 * (optional) is told of each player event.
 */
const watchSongs = async (
  config,
  {
    players,
    openDb,
    readSong,
    send = (notice, replaceId) =>
      sendNotification(notice, config.daemon, replaceId, { colors: barSettings(config).colors }),
    cover,
    liked = null,
    likes = null,
    onTrack = null,
    onEvent = _.noop,
    mpdWatcher = watchMpd,
    spotifyWatcher = watchSpotify
  }
) => {
  const notifier = createNotifier({
    describe: context => songNotice(context, { config, openDb, readSong, cover, liked, likes }),
    send,
    onTrack
  });
  const stopSpotify = spotifyWatcher(() => {
    onEvent();
    notifier.check(players.spotify);
  });
  notifier.check(players.spotify);
  const stopMpd = await mpdWatcher(config.mpd, () => {
    onEvent();
    notifier.check(players.mpd);
  });
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
  titleEnd,
  defaultFields,
  libraryDb,
  sendNotification,
  songNotice,
  trackKey,
  watchMpd,
  watchSongs,
  watchSpotify
};
