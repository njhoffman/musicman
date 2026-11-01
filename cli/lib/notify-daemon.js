const PrettyError = require('pretty-error');

const { loadConfig } = require('musicman-common/config');
const logger = require('./utils/logger.js');
const { connectMpd } = require('./clients/mpd.js');
const { watchSongs } = require('./notify/notification.js');

const pe = new PrettyError();

const config = loadConfig({ create: true });
logger.configure(config.output);
logger.configureLogFile(config.logger.file);
logger.configureColors(config.logger.colors);

const run = async () => {
  const mpdClient = await connectMpd(config.mpd);
  await watchSongs(mpdClient, config);
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
