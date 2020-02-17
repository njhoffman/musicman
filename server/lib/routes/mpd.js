const _ = require('lodash');
const Router = require('express-promise-router');

const { MPD_STATUS, MPD_STATS, MPD_CURRENT_SONG } = require('../constants');
const logger = require('../utils/logger');
const config = require('../../../common/config');

let status = {};
let song = {};
let stats = {};

const getDifferences = (before, after, ignored = []) => {
  const diff = _.fromPairs(
    _.keys(before)
      .concat(_.keys(after))
      .filter(key => !ignored.includes(key) && !_.isEqual(after[key], before[key]))
      .map(key => [key, [before[key], after[key]]])
  );
  return diff;
};

const getStatus = async (mpdClient, broadcast) => {
  const parsed = await mpdClient.sendCommandAsync('status');
  const ignored = ['elapsed'];

  const differences = getDifferences(parsed, status, ignored);
  status = parsed;

  if (_.keys(differences).length > 0) {
    broadcast(MPD_STATUS, differences);
  }
};

const getStats = async (mpdClient, broadcast) => {
  const parsed = await mpdClient.sendCommandAsync('stats');
  const differences = getDifferences(parsed, stats);
  stats = parsed;
  if (_.keys(differences).length > 0) {
    // logger.trace
    broadcast(MPD_STATS, differences);
  }
};

const getCurrentSong = async (mpdClient, broadcast) => {
  const parsed = await mpdClient.sendCommandAsync('currentsong');
  const differences = getDifferences(parsed, song);
  song = parsed;
  if (_.keys(differences).length > 0) {
    broadcast(MPD_CURRENT_SONG, differences);
  }
};

module.exports = modules => {
  const { broadcast, mpdClient } = modules;

  mpdClient.on('error', err => {
    logger.info('MPD ERROR', err);
    throw new Error(err);
  });

  mpdClient.on('ready', () => {
    logger.info(`MPD connected at ${config.mpd.host}:${config.mpd.port}`);
    getStats(mpdClient, broadcast);
  });

  mpdClient.on('system', (name, ...args) => {
    const systemMap = {
      database: () => {},
      update: () => {},
      stored_playlist: () => {},
      playlist: () => {},
      player: () => getStatus(mpdClient, broadcast),
      mixer: () => {},
      output: () => {},
      options: () => {},
      sticker: () => {},
      subscription: () => {},
      message: () => {}
    };
    logger.info(`system update: ${name}`);
    // update player => getCurrentSong, getStatus
    // update
    if (args.length > 0) {
      logger.info(args);
    }

    systemMap[name](args);
  });

  setInterval(() => {
    getStatus(mpdClient, broadcast);
    // getStats(mpdClient, broadcast);
    getCurrentSong(mpdClient, broadcast);
  }, 3000);

  const router = new Router();

  router.get('/mpd', (req, res) => {
    res.send({ version: config.version });
  });
  return router;
};
