const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const { Menu, notifyError, notifyNotice } = require('../menu/menu.js');
const { songActions: createSongActions } = require('../menu/actions.js');
const { mpdPlayer, spotifyPlayer } = require('../player/players.js');
const { panelTheme, panelView } = require('../menu/rofi.js');
const { lazyUserClient } = require('../spotify/userClient.js');
const { autoBackup, getMeta, openLibrary } = require('../db/index.js');
const shuffleCommand = require('./shuffle.js');
const { spotifyContextOf } = require('../status/context.js');
const { beginJournal, endJournal } = require('../history/journal.js');
const { finishRun, startRun } = require('../utils/runs.js');
const {
  assignMetadata,
  getFilteredFiles,
  saveMetadata,
  sortEditedFiles,
  updateLibraryFiles
} = require('./common.js');

// files beets moved during this menu session (old path to new), so the playing song, which MPD still
// knows by its old path, is read from where it is now
const movedFiles = new Map();
const currentPath = file => movedFiles.get(file) || file;

const readSongs = config => files =>
  getFilteredFiles({ options: {}, config }, _.map(files, currentPath));

// writes assignments to one file the way edit does, resolving to the metadata read back; a song in
// Unrated the change gave a rating and a grouping is filed away by beets right away, and said so
const writeSong =
  (config, { notice = notifyNotice, sortFiles = sortEditedFiles } = {}) =>
  async (file, assignments) => {
    const [song] = await readSongs(config)([file]);
    saveMetadata([assignMetadata(assignments)(song)], config);
    await updateLibraryFiles({ files: [currentPath(file)], options: {}, config });
    const [[, after]] = await readSongs(config)([file]);
    const sorted = await sortFiles({ files: [currentPath(file)], options: {}, config });
    const baseDirectory = path.resolve(config.mpd.baseDirectory);
    for (const { to, grouping, status } of sorted) {
      if (status === 'sorted' && to) {
        movedFiles.set(file, path.join(baseDirectory, to));
      }
      if (status === 'sorted') {
        await notice(`Moved to ${to || `its ${grouping} folder`}`);
      }
    }
    return after;
  };

// each menu action is archived as its own run, so musicman undo takes back one press at a time
const withRun = config => async (label, action) => {
  const run = startRun({ command: 'menu', args: [label], config });
  beginJournal({ run, config });
  autoBackup(config);
  let result;
  let error;
  try {
    result = await action();
    return result;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    endJournal();
    finishRun(run, { config, result, error });
  }
};

const openDb = config => () => {
  if (!fs.existsSync(config.db.path)) {
    throw new Error(`No library database at ${config.db.path}, run: musicman db --update`);
  }
  return openLibrary(config);
};

/**
 * The source the menu's reshuffle button shuffles for a Spotify track: the playlist or Liked Songs it
 * plays from (contextOf), unless that is the shuffle playlist itself; else the last musicman shuffle
 * source. Resolves to { name, terms } or null.
 */
const reshuffleSource = async ({ track, contextOf, lastSource, shufflePlaylistId }) => {
  const context = await contextOf(track).catch(() => null);
  if (context && context.type === 'collection') {
    return { name: 'Liked Songs', terms: ['liked'] };
  }
  if (
    context &&
    context.type === 'playlist' &&
    context.uri &&
    context.uri !== `spotify:playlist:${shufflePlaylistId}`
  ) {
    return { name: context.name || 'this playlist', terms: [context.uri] };
  }
  return lastSource ? { name: lastSource.name, terms: lastSource.terms } : null;
};

// the menu's reshuffle button: the source reshuffleSource picks when the menu is drawn, shuffled again
const reshuffle = (config, env) => {
  let db = null;
  let picked = null;
  const contextOf = spotifyContextOf(lazyUserClient(config, env));
  return {
    source: async track => {
      if (!db && fs.existsSync(config.db.path)) {
        db = openLibrary(config);
      }
      picked = await reshuffleSource({
        track,
        contextOf,
        lastSource: db && getMeta(db, shuffleCommand.lastSourceKey),
        shufflePlaylistId: db && getMeta(db, shuffleCommand.playlistIdKey)
      });
      return picked ? picked.name : null;
    },
    run: () => shuffleCommand.run({ options: { terms: picked ? picked.terms : [] }, config, env })
  };
};

// menu: a rofi menu with playback controls and tag buttons for the song playing in MPD or Spotify
const menuCommand = async ({
  config,
  players,
  view,
  songActions,
  env = process.env,
  notify = notifyError
}) => {
  let menu;
  try {
    menu = createMenu({ config, players, view, songActions, env });
  } catch (err) {
    // a mistake in menu.buttons is announced like the menu's other errors
    await notify(err.message);
    throw err;
  }
  await menu.open();
  return true;
};

const createMenu = ({ config, players, view, songActions, env }) =>
  new Menu({
    reshuffle: reshuffle(config, env),
    players: players || [spotifyPlayer(), mpdPlayer(config)],
    view:
      view ||
      panelView({
        args: _.get(config, 'menu.rofiArgs') || [],
        theme: _.get(config, 'menu.theme') || panelTheme
      }),
    songActions:
      songActions ||
      createSongActions({
        config,
        openDb: openDb(config),
        client: lazyUserClient(config, env),
        readSongs: readSongs(config),
        writeSong: writeSong(config),
        withRun: withRun(config),
        currentFile: currentPath
      })
  });

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'menu',
  description:
    'Open a rofi menu for the song playing in MPD or Spotify: playback controls, tag and rating buttons',
  usage: 'musicman menu',
  switches: [],
  completes: [],
  func: menuCommand,
  defaultTarget,
  targetArgs: false,
  readSongs,
  reshuffleSource,
  withRun,
  writeSong
};
