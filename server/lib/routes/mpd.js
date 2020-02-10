const _ = require('lodash');
const Router = require('express-promise-router');

const { MPD_STATUS, MPD_STATS, MPD_CURRENT_SONG } = require('../constants');
const logger = require('../utils/logger');
const config = require('../../config');

let status = {};
let song = {};
let stats = {};

const getDifferences = (before, after, ignored = []) =>
  _.fromPairs(
    _.keys(after)
      .filter(key => _.indexOf(ignored, key) === -1 && !_.isEqual(after[key], before[key]))
      .map(key => [key, [before[key], after[key]]])
  );

module.exports = modules => {
  const { broadcast, mpdClient } = modules;

  const getStatus = async () => {
    const parsed = await mpdClient.sendCommandAsync('status');
    const ignored = ['elapsed'];

    const differences = getDifferences(parsed, status, ignored);
    status = parsed;

    if (_.keys(differences).length > 0) {
      broadcast(MPD_STATUS, differences);
    }
  };

  const getStats = async () => {
    const parsed = await mpdClient.sendCommandAsync('stats');
    const differences = getDifferences(parsed, stats);
    stats = parsed;
    if (_.keys(differences).length > 0) {
      broadcast(MPD_STATS, differences);
    }
  };

  const getCurrentSong = async () => {
    const parsed = await mpdClient.sendCommandAsync('currentsong');
    const differences = getDifferences(parsed, song);
    song = parsed;
    if (_.keys(differences).length > 0) {
      broadcast(MPD_CURRENT_SONG, differences);
    }
  };

  mpdClient.on('error', err => {
    logger.info('MPD ERROR', err);
    throw new Error(err);
  });

  mpdClient.on('ready', () => {
    logger.info(`MPD connected at ${config.mpd.host}:${config.mpd.port}`);
    getStatus();
    getStats();
  });

  mpdClient.on('system', (name, ...args) => {
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
    logger.info(`update: ${name}`);
    if (args.length > 0) {
      logger.info(args);
    }

    systemMap[name](args);
  });

  setInterval(() => {
    getStatus();
    getStats();
    getCurrentSong();
  }, 3000);

  const router = new Router();

  router.get('/mpd', (req, res) => {
    res.send({ version: config.version });
  });
  return router;
};
