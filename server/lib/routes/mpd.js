const _ = require('lodash');
const Router = require('express-promise-router');

const mpd = require('@lib/mpd');
const logger = require('@lib/utils/logger');
const config = require('@config');

const client = mpd.connect({ port: config.mpd.port, host: config.mpd.host });

let status = {};
const getStatus = cb => {
  client.sendCommand(mpd.cmd('status', []), (err, msg) => {
    if (err) {
      throw err;
    }
    const parsed = _.fromPairs(
      msg
        .split('\n')
        .filter(Boolean)
        .map(line => line.split(':').map(val => val.trim()))
    );

    const differences = _.fromPairs(
      _.keys(parsed)
        .filter(key => !_.isEqual(parsed[key], status[key]))
        .map(key => [key, { before: status[key], after: parsed[key] }])
    );
    logger.debug(differences);
    status = parsed;
    if (_.isFunction(cb)) {
      cb(parsed);
    }
  });
};

setInterval(() => {
  getStatus();
}, 3000);

client.on('error', err => {
  logger.info('MPD ERROR', err);
  throw new Error(err);
});

client.on('ready', () => {
  logger.info(`MPD connected at ${config.mpd.host}:${config.mpd.port}`);
  getStatus();
});

client.on('system', (name, ...args) => {
  const systemMap = {
    database: () => {},
    update: () => {},
    stored_playlist: () => {},
    playlist: () => {},
    player: getStatus,
    mixer: () => {},
    output: () => {},
    options: () => {},
    sticker: () => {},
    subscription: () => {},
    message: () => {}
  };
  logger.info(`update ${name}`);
  if (args.length > 0) {
    logger.info(args);
  }

  systemMap[name](args);
});

const router = new Router();
router.get('/version', (req, res) => {
  res.send({ version: config.version });
});

module.exports = router;
