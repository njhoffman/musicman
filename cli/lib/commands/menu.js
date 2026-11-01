const _ = require('lodash');
const fs = require('fs');

const { Menu, notifyError } = require('../menu/menu.js');
const { songActions: createSongActions } = require('../menu/actions.js');
const { mpdPlayer, spotifyPlayer } = require('../menu/players.js');
const { panelTheme, panelView } = require('../menu/rofi.js');
const { lazyUserClient } = require('../spotify/userClient.js');
const { autoBackup, getMeta, openLibrary } = require('../db/index.js');
const shuffleCommand = require('./shuffle.js');
const { beginJournal, endJournal } = require('../history/journal.js');
const { finishRun, startRun } = require('../utils/runs.js');
const {
  assignMetadata,
  getFilteredFiles,
  saveMetadata,
  updateLibraryFiles
} = require('./common.js');

const readSongs = config => files => getFilteredFiles({ options: {}, config }, files);

// writes assignments to one file the way edit does, resolving to the metadata read back
const writeSong = config => async (file, assignments) => {
  const [song] = await readSongs(config)([file]);
  saveMetadata([assignMetadata(assignments)(song)], config);
  await updateLibraryFiles({ files: [file], options: {}, config });
  const [[, after]] = await readSongs(config)([file]);
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

// the menu's reshuffle button: the last musicman shuffle source, shuffled again
const reshuffle = (config, env) => {
  let db = null;
  return {
    source: () => {
      if (!db && !fs.existsSync(config.db.path)) {
        return null;
      }
      db = db || openLibrary(config);
      return _.get(getMeta(db, shuffleCommand.lastSourceKey), 'name') || null;
    },
    run: () => shuffleCommand.run({ options: { terms: [] }, config, env })
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
        withRun: withRun(config)
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
  withRun,
  writeSong
};
