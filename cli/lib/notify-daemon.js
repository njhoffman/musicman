const PrettyError = require('pretty-error');

const { loadConfig } = require('musicman-common/config');
const logger = require('./utils/logger.js');
const { getFilteredFiles } = require('./commands/common.js');
const { openLibrary } = require('./db/index.js');
const { libraryDb, watchSongs } = require('./notify/notification.js');
const { mpdPlayer, spotifyConnectPlayer, spotifyPlayer } = require('./player/players.js');
const { pollHandoff, shuffleHandoff } = require('./notify/shuffleHandoff.js');
const { getCredentials, missingCredentials } = require('./spotify/credentials.js');
const { lazyUserClient } = require('./spotify/userClient.js');
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

// continuing a shuffle past the tracks it started needs the Spotify Web API: the credentials come from
// the environment (pnpm daemon:install writes them to the service's EnvironmentFile) or the config
const handoff = openDb => {
  const missing = missingCredentials(getCredentials(config, process.env));
  if (missing.length > 0) {
    logger.info(
      `No Spotify credentials (${missing.join(', ')}): shuffles stop after the tracks they started; run pnpm daemon:install from a shell that has them`
    );
    return null;
  }
  const client = lazyUserClient(config, process.env);
  const onTrack = shuffleHandoff({ openDb, client });
  // a shuffle played on the phone with the desktop app closed is followed through the Web API
  pollHandoff({
    handoff: onTrack,
    local: spotifyPlayer(),
    remote: spotifyConnectPlayer({ client })
  });
  return onTrack;
};

// notifies about each new track in MPD or the Spotify desktop app until stopped
const run = () => {
  const openDb = libraryDb(config, openLibrary);
  return watchSongs(config, {
    players: { mpd: mpdPlayer(config), spotify: spotifyPlayer() },
    openDb,
    readSong,
    onTrack: handoff(openDb)
  });
};

run();

process.on('unhandledRejection', err => {
  logger.error(`Unhandled Rejection ${err.name}: ${err.message}\n`, pe.render(err));
  process.exit(1);
});

process.on('uncaughtException', err => {
  logger.error(`Unhandled Exception ${err.name}: ${err.message}\n`, pe.render(err));
  process.exit(1);
});
