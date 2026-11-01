const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const { getFilteredFiles, reportErrors } = require('./common.js');
const { openLibrary } = require('../db/index.js');
const { outputFormat } = require('../output/formats.js');
const { renderStatus } = require('../output/status.js');
const { choosePlayer, mpdPlayer, spotifyPlayer } = require('../player/players.js');
const { spotifyContextOf } = require('../status/context.js');
const { nowPlaying } = require('../status/nowPlaying.js');
const { lazyUserClient } = require('../spotify/userClient.js');
const { availableWidth, consoleLog } = require('../utils/logger.js');

// how often --watch redraws, in milliseconds
const watchInterval = 1000;

// terminal control: alternate screen, cursor home and clear, hidden cursor
const screen = {
  enter: '\u001b[?1049h\u001b[?25l',
  frame: '\u001b[H\u001b[J',
  leave: '\u001b[?25h\u001b[?1049l'
};

// the parsed tags of one file, read from the file
const readSongFrom = config => async file => {
  const [[, meta] = []] = await getFilteredFiles({ options: {}, config }, [file]);
  return meta || null;
};

const openDb = config => (fs.existsSync(config.db.path) ? openLibrary(config) : null);

/**
 * fn memoized on the key of its argument, keeping only the last result: a song's tags and its Spotify
 * context are looked up again only when the track changes.
 */
const lastOf = (fn, key) => {
  let last = { key: undefined, value: null };
  return async arg => {
    const current = key(arg);
    if (current !== last.key) {
      last = { key: current, value: await fn(arg) };
    }
    return last.value;
  };
};

// redraws the screen every interval until q, Escape, or ctrl-c; resolves to the last status
const watch = ({ gather, render, out, input, interval }) =>
  new Promise((resolve, reject) => {
    let last = null;
    let timer = null;
    let stopped = false;
    const stop = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearTimeout(timer);
      input.removeListener('data', onKey);
      if (input.setRawMode) {
        input.setRawMode(false);
      }
      input.pause();
      out.write(screen.leave);
      resolve(last);
    };
    const onKey = data => {
      if (['q', 'Q', '\u0003', '\u001b'].includes(String(data))) {
        stop();
      }
    };
    const tick = async () => {
      try {
        last = await gather();
        if (!stopped) {
          out.write(`${screen.frame}${render(last).join('\n')}\n`);
          timer = setTimeout(tick, interval);
        }
      } catch (err) {
        stop();
        reject(err);
      }
    };
    if (input.setRawMode) {
      input.setRawMode(true);
    }
    input.resume();
    input.on('data', onKey);
    out.write(screen.enter);
    tick();
  });

/**
 * status: the now playing screen for MPD or Spotify (whichever plays, Spotify when both do): player and
 * modes, the song with a progress bar, its library tags, the cached playlists holding it, and where it
 * plays from. --format json prints the same as data; --watch redraws every second until q.
 */
const statusCommand = async ({
  options = {},
  config,
  env = process.env,
  players = [spotifyPlayer(), mpdPlayer(config)],
  db: givenDb,
  readSong = readSongFrom(config),
  contextOf = spotifyContextOf(lazyUserClient(config, env)),
  out = process.stdout,
  input = process.stdin,
  interval = watchInterval
}) => {
  const switches = options.switches || {};
  const format = outputFormat(switches);
  if (!['default', 'json'].includes(format)) {
    throw new Error(`status prints the default view or --format json, not ${format}`);
  }
  if (switches.watch && (format === 'json' || !out.isTTY || !input.isTTY)) {
    throw new Error('status --watch needs a terminal and the default view');
  }
  const db = givenDb === undefined ? openDb(config) : givenDb;
  const icons = _.get(config, 'status.icons', true) !== false;
  const render = status =>
    renderStatus(status, {
      width: availableWidth(),
      icons,
      baseDirectory: path.resolve(config.mpd.baseDirectory)
    });
  // --watch looks a song's tags and Spotify context up again only when the track changes
  const songReader = switches.watch ? lastOf(readSong, _.identity) : readSong;
  const contextReader = switches.watch ? lastOf(contextOf, track => track.trackId) : contextOf;
  const gather = () =>
    nowPlaying({ config, players, db, readSong: songReader, contextOf: contextReader });
  try {
    if (format === 'json') {
      const status = await gather();
      out.write(`${JSON.stringify(status, null, 2)}\n`);
      return status;
    }
    if (!switches.watch) {
      const status = await gather();
      consoleLog(render(status).join('\n'));
      return status;
    }
    return await watch({
      gather,
      render,
      out,
      input,
      interval
    });
  } finally {
    if (db && givenDb === undefined) {
      db.close();
    }
  }
};

// bare musicman is the now playing screen while MPD or Spotify plays or is paused, else view
const defaultArgs = async (args, config, players = [spotifyPlayer(), mpdPlayer(config)]) => {
  if (args.length > 0) {
    return args;
  }
  const { active } = await choosePlayer(players);
  return active ? ['status'] : args;
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'status',
  description:
    'Show the song playing in MPD or Spotify: tags, progress, playlists, and where it plays from',
  usage: 'musicman status [--watch] [--format json]',
  switches: ['watch', 'format'],
  completes: [],
  func: reportErrors(statusCommand),
  run: statusCommand,
  defaultTarget,
  targetArgs: false,
  terms: false,
  defaultArgs
};
