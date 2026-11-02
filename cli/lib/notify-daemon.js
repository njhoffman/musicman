const PrettyError = require('pretty-error');

const { loadConfig } = require('musicman-common/config');
const logger = require('./utils/logger.js');
const { getFilteredFiles } = require('./commands/common.js');
const { openLibrary } = require('./db/index.js');
const { libraryDb, watchSongs } = require('./notify/notification.js');
const { mpdPlayer, spotifyPlayer } = require('./player/players.js');
const { publishPaths } = require('./utils/paths.js');

const pe = new PrettyError();

const config = loadConfig({ create: true });
logger.configure(config.output);
logger.configureLogFile(config.logger.file);
logger.configureColors(config.logger.colors);

// paths.json for other programs (sleeve), also when only the daemon runs after a config change
try {
  publishPaths(config);
} catch (err) {
  logger.warn(`Could not write paths.json: ${err.message}`);
}

// the parsed tags of one file, read from the file
const readSong = async file => {
  const [[, meta] = []] = await getFilteredFiles({ options: {}, config }, [file]);
  return meta || null;
};

// notifies about each new track in MPD or the Spotify desktop app until stopped
const run = () =>
  watchSongs(config, {
    players: { mpd: mpdPlayer(config), spotify: spotifyPlayer() },
    openDb: libraryDb(config, openLibrary),
    readSong
  });

run();

process.on('unhandledRejection', err => {
  logger.error(`Unhandled Rejection ${err.name}: ${err.message}\n`, pe.render(err));
  process.exit(1);
});

process.on('uncaughtException', err => {
  logger.error(`Unhandled Exception ${err.name}: ${err.message}\n`, pe.render(err));
  process.exit(1);
});
