const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const { reportErrors } = require('./common.js');
const { findSongs } = require('./search.js');
const { playTracks } = require('./shuffle.js');
const { queueSongs } = require('../clients/mpd.js');
const { openLibrary } = require('../db/index.js');
const { captureBack, commitBack, forgetBack, goBack, readBack } = require('../player/back.js');
const { backFile, peekData, peekText, publishBack } = require('../player/backFile.js');
const { shuffleOrder } = require('../spotify/shuffle.js');
const { clock } = require('../menu/menu.js');
const {
  choosePlayer,
  mpdPlayer,
  nextRepeat,
  repeatCycle,
  spotifyConnectPlayer,
  spotifyPlayer
} = require('../player/players.js');
const { lazyUserClient } = require('../spotify/userClient.js');
const logger = require('../utils/logger.js');

const usage = [
  'musicman player [mpd | spotify] [action]',
  '  status (default) | toggle | play | pause | stop | next | prev',
  '  seek -30 | +30 | 90 | 1:30     vol -5 | +5 | 40',
  '  shuffle on|off|toggle          repeat off|playlist|track|next',
  '  queue [count]                  play <terms>   add <terms>   (search terms: field:value, text)',
  '  back                           return to what played before the last play <terms>',
  '  play and add: --shuffle (random order), --files (paths on stdin, MPD); play: --main (forget back)',
  '  back --peek [--format json]    print the back point; --peek --path: the file it is published to'
].join('\n');

const sources = ['mpd', 'spotify'];

// upcoming tracks queue lists unless a count is given
const defaultQueueCount = 10;

// time for a player to report the new song after a skip or a new queue, before its state is shown
const settleMs = 400;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// a position: relative (+30, -30) or absolute seconds (90) or minutes:seconds (1:30)
const parseSeek = value => {
  const text = `${value || ''}`;
  if (/^[+-]\d+$/.test(text)) {
    return { relative: Number(text) };
  }
  if (/^\d+$/.test(text)) {
    return { absolute: Number(text) };
  }
  const clockMatch = /^(\d+):([0-5]\d)$/.exec(text);
  if (clockMatch) {
    return { absolute: Number(clockMatch[1]) * 60 + Number(clockMatch[2]) };
  }
  throw new Error(`seek takes +seconds, -seconds, seconds, or m:ss, not '${text}'`);
};

// a volume: relative (+5, -5) or absolute percent (0 to 100)
const parseVolume = value => {
  const text = `${value || ''}`;
  if (/^[+-]\d+$/.test(text)) {
    return { relative: Number(text) };
  }
  if (/^\d+$/.test(text) && Number(text) <= 100) {
    return { absolute: Number(text) };
  }
  throw new Error(`vol takes +percent, -percent, or a percent from 0 to 100, not '${text}'`);
};

/**
 * The player named first (mpd or spotify, optional), the action, and its arguments. Throws for an
 * unknown action or a value it does not take, so a typo never sends a command.
 */
const parseArgs = (terms, switches = {}) => {
  const words = [...terms];
  const source = sources.includes(_.toLower(words[0])) ? _.toLower(words.shift()) : null;
  const action = _.toLower(words.shift() || 'status');
  const args = words;
  const check = {
    status: () => null,
    toggle: () => null,
    pause: () => null,
    stop: () => null,
    next: () => null,
    prev: () => null,
    play: () => null,
    back: () => null,
    add: () => {
      if (args.length === 0 && !switches.files) {
        throw new Error('add needs search terms, e.g. musicman player add context:Study');
      }
    },
    seek: () => parseSeek(args[0]),
    vol: () => parseVolume(args[0]),
    shuffle: () => {
      if (!['on', 'off', 'toggle'].includes(_.toLower(args[0]))) {
        throw new Error(`shuffle takes on, off, or toggle, not '${args[0] || ''}'`);
      }
    },
    repeat: () => {
      if (![...repeatCycle, 'next'].includes(_.toLower(args[0]))) {
        throw new Error(`repeat takes ${repeatCycle.join(', ')}, or next, not '${args[0] || ''}'`);
      }
    },
    queue: () => {
      if (args.length && !/^\d+$/.test(args[0])) {
        throw new Error(`queue takes a count of tracks, not '${args[0]}'`);
      }
    }
  };
  const name = { volume: 'vol', previous: 'prev' }[action] || action;
  if (!check[name]) {
    throw new Error(`Unknown action '${action}'\n${usage}`);
  }
  check[name]();
  return { source, action: name, args };
};

/**
 * The player an action controls: the one named, else the active one (playing, Spotify when both are,
 * else paused), else one that runs (a stopped MPD, so play works). Throws when it is not running.
 */
const pickPlayer = async (players, source) => {
  const { active, all } = await choosePlayer(players);
  if (source) {
    // a remote player is asked here even when choosePlayer left it out (another player was playing)
    const remote = _.filter(
      players,
      player => player.remote && player.source === source && !_.find(all, { player })
    );
    const candidates = [
      ...all,
      ...(await Promise.all(
        _.map(remote, async player => ({ player, status: await player.state() }))
      ))
    ];
    const sameSource = _.filter(candidates, ({ player }) => player.source === source);
    const named = _.find(sameSource, ({ status }) => status.state) || sameSource[0];
    if (!named || !named.status.state) {
      const name = source === 'mpd' ? 'MPD' : 'Spotify';
      throw new Error(
        `${name} is not running${named && named.status.error ? ` (${named.status.error})` : ''}`
      );
    }
    return named;
  }
  const picked = active || _.find(all, ({ status }) => status.state);
  if (!picked) {
    throw new Error('Neither MPD nor Spotify is running');
  }
  return picked;
};

// one line about a player: its state, the track and how far it played, volume, shuffle and repeat
const describeState = (player, status) => {
  const { track } = status;
  const parts = [
    `${player.name} ${status.state || 'not running'}`,
    track ? `${_.compact([track.artist, track.title]).join(' - ')}` : null,
    track && track.duration ? `${clock(track.position)} / ${clock(track.duration)}` : null,
    _.isNil(status.volume) ? null : `vol ${status.volume}%`,
    _.isBoolean(status.shuffle) ? `shuffle ${status.shuffle ? 'on' : 'off'}` : null,
    status.repeat ? `repeat ${status.repeat}` : null
  ];
  return _.compact(parts).join('  ·  ');
};

// the songs of search terms, or an error naming the terms when none match
const songsFor = async (terms, config, find) => {
  const songs = await find({ terms, config });
  if (songs.length === 0) {
    throw new Error(`No songs match ${terms.join(' ')}`);
  }
  return songs;
};

// the Spotify ids of songs, with how many have none (never matched to Spotify)
const spotifyIds = songs => {
  const ids = _.uniq(_.compact(_.map(songs, ([, meta]) => meta && meta.sp_track_id)));
  return {
    ids,
    missing: songs.length - _.filter(songs, ([, meta]) => meta && meta.sp_track_id).length
  };
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// all of a stream (stdin) as text
const readAll = input =>
  new Promise((resolve, reject) => {
    let text = '';
    input.setEncoding('utf8');
    input.on('data', chunk => {
      text += chunk;
    });
    input.on('end', () => resolve(text));
    input.on('error', reject);
  });

/**
 * The songs of --files: paths under the MPD music directory (or absolute paths inside it), one per line,
 * in the order given, as [absolute file, {}] like search results. Paths that are not there are left out
 * with a warning; throws when none is left.
 */
const songsOfFiles = (text, config, exists = fs.existsSync) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const lines = _.compact(_.map(`${text || ''}`.split('\n'), line => line.trim()));
  if (lines.length === 0) {
    throw new Error('--files reads the paths to play on stdin, one per line, and got none');
  }
  const resolved = _.map(lines, line => {
    const file = path.resolve(baseDirectory, line);
    const inside = file.startsWith(`${baseDirectory}${path.sep}`);
    return { line, file, known: inside && exists(file) };
  });
  const unknown = _.reject(resolved, 'known');
  if (unknown.length === resolved.length) {
    throw new Error(`None of the ${plural(lines.length, 'path')} on stdin is in ${baseDirectory}`);
  }
  if (unknown.length > 0) {
    logger.warn(
      `${plural(unknown.length, 'path')} not in ${baseDirectory} left out: ${_.map(
        _.take(unknown, 3),
        'line'
      ).join(', ')}${unknown.length > 3 ? ', ...' : ''}`
    );
  }
  return _.map(_.filter(resolved, 'known'), ({ file }) => [file, {}]);
};

/**
 * Plays (replace) or queues songs (search results or --files, [file, meta] pairs): on MPD by their
 * files, on Spotify by their Spotify ids through the Web API (Premium and a Connect device; songs
 * without an id are left out).
 */
const loadSongs = async ({
  player,
  songs,
  replace,
  config,
  client,
  queue,
  play,
  onLoaded = () => {}
}) => {
  if (player.source === 'mpd') {
    const baseDirectory = path.resolve(config.mpd.baseDirectory);
    const count = await queue(
      config.mpd,
      _.map(songs, ([file]) => path.relative(baseDirectory, file)),
      { replace }
    );
    onLoaded(_.map(songs, ([file]) => file));
    logger.info(`${replace ? 'Playing' : 'Added'} ${plural(count, 'song')} in MPD`);
    return { source: 'mpd', count };
  }
  const { ids, missing } = spotifyIds(songs);
  if (ids.length === 0) {
    throw new Error(`None of the ${plural(songs.length, 'matching song')} has a Spotify id`);
  }
  const skipped = missing ? ` (${plural(missing, 'song')} without a Spotify id left out)` : '';
  if (replace) {
    const { device, count } = await play(client(), ids);
    onLoaded(ids.slice(0, count));
    logger.info(`Playing ${plural(count, 'song')} on ${device}${skipped}`);
    return { source: 'spotify', count, device };
  }
  const spotify = client();
  for (const id of ids) {
    await spotify.request(
      'POST',
      `/me/player/queue?uri=${encodeURIComponent(`spotify:track:${id}`)}`
    );
  }
  logger.info(`Added ${plural(ids.length, 'song')} to the Spotify queue${skipped}`);
  return { source: 'spotify', count: ids.length };
};

// the upcoming tracks: MPD's queue after the song playing, Spotify's (the Web API shows about 20)
const listQueue = async ({ player, count, client }) => {
  if (player.source === 'mpd') {
    const { length, current, tracks } = await player.queue(count);
    logger.info(
      `MPD queue: ${plural(length, 'song')}${current ? `, at ${current}` : ''}${
        tracks.length ? '' : ', nothing after it'
      }`
    );
    _.each(tracks, track =>
      logger.info(
        `  ${`${track.position}`.padStart(4)}  ${_.compact([track.artist, track.title]).join(' - ')}  ${clock(
          track.duration
        )}`
      )
    );
    return { source: 'mpd', length, tracks };
  }
  const { queue = [] } = (await client().get('/me/player/queue')) || {};
  const tracks = _.map(_.take(queue, count), item => ({
    title: item.name,
    artist: _.map(item.artists, 'name').join(', '),
    duration: (item.duration_ms || 0) / 1000
  }));
  logger.info(`Spotify queue: next ${plural(tracks.length, 'track')}`);
  _.each(tracks, (track, i) =>
    logger.info(
      `  ${`${i + 1}`.padStart(4)}  ${_.compact([track.artist, track.title]).join(' - ')}  ${clock(
        track.duration
      )}`
    )
  );
  return { source: 'spotify', tracks };
};

// the library database for the back point, or null without one (tests, a first run)
const openBackDb = config => () =>
  config.db && config.db.path && fs.existsSync(config.db.path) ? openLibrary(config) : null;

/**
 * Plays search results as a side trip: what the player played before is remembered first (see
 * lib/player/back.js), and stored once the songs play, so player back returns there.
 */
const playSideTrip = async ({ player, status, openDb, client, load, main = false, env }) => {
  const db = openDb();
  try {
    let captured = null;
    if (db && !main) {
      try {
        captured = await captureBack({ db, player, status, client });
      } catch (err) {
        logger.warn(
          `Could not remember what was playing (${err.message}), player back will not return there`
        );
      }
    }
    let side = null;
    const result = await load(ids => {
      side = { source: player.source, ids };
    });
    if (db && main) {
      forgetBack(db, env);
    } else if (db && side) {
      commitBack(db, captured, side, env);
    }
    return result;
  } finally {
    if (db) {
      db.close();
    }
  }
};

// player back: restores the back point, on the player it was saved from
const returnBack = async ({ players, openDb, client, hostname, env }) => {
  const db = openDb();
  if (!db) {
    throw new Error('No library database, player back has nothing to return to');
  }
  try {
    const result = await goBack({
      db,
      mpd: _.find(players, { source: 'mpd' }),
      client,
      hostname,
      env
    });
    const where = result.source === 'mpd' ? 'MPD' : result.device;
    const song = _.compact([result.track.artist, result.track.title]).join(' - ');
    const skipped = result.skipped ? ` (${plural(result.skipped, 'missing song')} left out)` : '';
    logger.info(`Back to ${song || 'the last playback'} on ${where}${skipped}`);
    return result;
  } finally {
    db.close();
  }
};

/**
 * player back --peek: prints the back point (peekText, or JSON with --format json) and publishes it again
 * (the runtime file is gone after a reboot); throws when there is none. --path prints the file instead.
 */
const peekBack = ({ switches, openDb, env, out }) => {
  if (switches.path) {
    out.write(`${backFile(env)}\n`);
    return { path: backFile(env) };
  }
  const db = openDb();
  const point = db ? readBack(db) : null;
  if (db) {
    db.close();
  }
  if (!point) {
    throw new Error('No back point: musicman player play <terms> remembers what played before it');
  }
  publishBack(point, env);
  out.write(switches.format === 'json' ? `${JSON.stringify(peekData(point))}\n` : peekText(point));
  return peekData(point);
};

/**
 * The switches player takes, checked against the action: --shuffle and --files go with play and add,
 * --main with play, --peek and --path with back. Throws for any other mix, so a typo never plays.
 */
const checkSwitches = (action, args, switches) => {
  const loads = ['play', 'add'].includes(action);
  const misplaced = [
    switches.shuffle && !loads && '--shuffle goes with play or add',
    switches.files && !loads && '--files goes with play or add',
    switches.main && action !== 'play' && '--main goes with play',
    switches.peek && action !== 'back' && '--peek goes with back',
    switches.path && !switches.peek && '--path goes with back --peek',
    switches.files &&
      _.without(args, '-').length > 0 &&
      '--files reads paths on stdin, not search terms'
  ];
  const [problem] = _.compact(misplaced);
  if (problem) {
    throw new Error(problem);
  }
};

/**
 * player: controls whichever of MPD and the Spotify desktop app is active (or the one named first): play,
 * pause, skip, seek, volume, shuffle, repeat, the queue, and playing or queueing search results. Spotify
 * is controlled through MPRIS, except playing and queueing songs and listing its queue (Web API), and
 * Spotify playing on another device (a phone, a speaker) through the Web API player endpoints.
 * play <terms> remembers what played before it, and back returns there (lib/player/back.js).
 * --shuffle plays them in random order, --main as a new main list (no back point), --files the paths on
 * stdin instead of search results (MPD only).
 * Dependencies (tests): players, client (lazy Spotify user client), find (findSongs), queue
 * (queueSongs), play (playTracks), openDb (the library database or null), readInput (stdin as text),
 * exists (fs.existsSync), random, out (stdout), hostname, settle.
 */
const playerCommand = async ({
  options = {},
  config,
  env = process.env,
  client = lazyUserClient(config, env),
  players = [spotifyPlayer(), mpdPlayer(config), spotifyConnectPlayer({ client })],
  find = findSongs,
  queue = queueSongs,
  play = playTracks,
  openDb = openBackDb(config),
  readInput = () => readAll(process.stdin),
  exists = fs.existsSync,
  random = Math.random,
  out = process.stdout,
  hostname,
  settle = settleMs
}) => {
  const switches = options.switches || {};
  const { source, action, args } = parseArgs(options.terms || [], switches);
  checkSwitches(action, args, switches);
  if (action === 'back' && switches.peek) {
    return peekBack({ switches, openDb, env, out });
  }
  if (action === 'back') {
    const result = await returnBack({ players, openDb, client, hostname, env });
    await wait(settle);
    const { player } = await pickPlayer(players, result.source);
    const after = await player.state();
    logger.info(describeState(player, after));
    return { source: player.source, action, state: after.state, track: after.track, result };
  }
  const loading = ['play', 'add'].includes(action) && (args.length > 0 || Boolean(switches.files));
  if (switches.files && source === 'spotify') {
    throw new Error('--files plays library files, on MPD only: musicman player mpd play --files -');
  }
  // playing search results with no player named or active goes to MPD
  const active = loading && !source ? (await choosePlayer(players)).active : null;
  if (switches.files && active && active.player.source === 'spotify') {
    throw new Error(
      'Spotify is playing and --files plays library files on MPD only: musicman player mpd play --files -'
    );
  }
  const { player, status } = await pickPlayer(
    players,
    source || (loading && (switches.files || !active) ? 'mpd' : null)
  );
  let result = null;
  if (loading) {
    const found = switches.files
      ? songsOfFiles(await readInput(), config, exists)
      : await songsFor(args, config, find);
    const songs = switches.shuffle ? shuffleOrder(found, random) : found;
    const load = onLoaded =>
      loadSongs({
        player,
        songs,
        replace: action === 'play',
        config,
        client,
        queue,
        play,
        onLoaded
      });
    if (action === 'play') {
      result = await playSideTrip({
        player,
        status,
        openDb,
        client,
        load,
        main: Boolean(switches.main),
        env
      });
      await wait(settle);
    } else {
      result = await load();
    }
  } else if (action === 'queue') {
    return listQueue({ player, count: Number(args[0]) || defaultQueueCount, client });
  } else if (action === 'seek') {
    const { relative, absolute } = parseSeek(args[0]);
    await (_.isNil(relative) ? player.seekTo(absolute) : player.seek(relative));
  } else if (action === 'vol') {
    const { relative, absolute } = parseVolume(args[0]);
    await (_.isNil(relative) ? player.setVolume(absolute) : player.volume(relative));
  } else if (action === 'shuffle') {
    await player.shuffle(_.toLower(args[0]));
  } else if (action === 'repeat') {
    const mode = _.toLower(args[0]);
    await player.repeat(mode === 'next' ? nextRepeat(status.repeat) : mode);
  } else if (action !== 'status') {
    await player[action]();
    if (['next', 'prev', 'play', 'toggle'].includes(action)) {
      await wait(settle);
    }
  }
  const after = action === 'status' ? status : await player.state();
  logger.info(describeState(player, after));
  return { source: player.source, action, state: after.state, track: after.track, result };
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'player',
  // field:value with an unknown field is free text here, not a filter mistake
  ownTerms: true,
  description:
    'Control MPD or the Spotify desktop app: play, pause, skip, seek, volume, queue, play search results and go back',
  usage,
  switches: ['shuffle', 'main', 'files', 'peek', 'path', 'format'],
  switchHelp: {
    files: 'With play or add: the files on stdin (paths under the MPD music directory), MPD only',
    format: 'With back --peek: json'
  },
  completes: ['filters'],
  func: reportErrors(playerCommand),
  run: playerCommand,
  defaultTarget,
  targetArgs: false,
  describeState,
  checkSwitches,
  parseArgs,
  parseSeek,
  songsOfFiles,
  parseVolume,
  pickPlayer
};
