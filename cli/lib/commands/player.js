const _ = require('lodash');
const path = require('path');

const { reportErrors } = require('./common.js');
const { findSongs } = require('./search.js');
const { playTracks } = require('./shuffle.js');
const { queueSongs } = require('../clients/mpd.js');
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
  '  queue [count]                  play <terms>   add <terms>   (search terms: field:value, text)'
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
const parseArgs = terms => {
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
    add: () => {
      if (args.length === 0) {
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

/**
 * Plays (replace) or queues the songs of search terms: on MPD by their files, on Spotify by their
 * Spotify ids through the Web API (Premium and a Connect device; songs without an id are left out).
 */
const loadSongs = async ({ player, terms, replace, config, client, find, queue, play }) => {
  const songs = await songsFor(terms, config, find);
  if (player.source === 'mpd') {
    const baseDirectory = path.resolve(config.mpd.baseDirectory);
    const count = await queue(
      config.mpd,
      _.map(songs, ([file]) => path.relative(baseDirectory, file)),
      { replace }
    );
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

/**
 * player: controls whichever of MPD and the Spotify desktop app is active (or the one named first): play,
 * pause, skip, seek, volume, shuffle, repeat, the queue, and playing or queueing search results. Spotify
 * is controlled through MPRIS, except playing and queueing songs and listing its queue (Web API), and
 * Spotify playing on another device (a phone, a speaker) through the Web API player endpoints.
 * Dependencies (tests): players, client (lazy Spotify user client), find (findSongs), queue
 * (queueSongs), play (playTracks), settle.
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
  settle = settleMs
}) => {
  const { source, action, args } = parseArgs(options.terms || []);
  const loading = ['play', 'add'].includes(action) && args.length > 0;
  // playing search results with no player named or active goes to MPD
  const { player, status } = await pickPlayer(
    players,
    source || (loading && !(await choosePlayer(players)).active ? 'mpd' : null)
  );
  let result = null;
  if (loading) {
    result = await loadSongs({
      player,
      terms: args,
      replace: action === 'play',
      config,
      client,
      find,
      queue,
      play
    });
    if (action === 'play') {
      await wait(settle);
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
  description:
    'Control MPD or the Spotify desktop app: play, pause, skip, seek, volume, queue, play search results',
  usage,
  switches: [],
  completes: ['filters'],
  func: reportErrors(playerCommand),
  run: playerCommand,
  defaultTarget,
  targetArgs: false,
  describeState,
  parseArgs,
  parseSeek,
  parseVolume,
  pickPlayer
};
