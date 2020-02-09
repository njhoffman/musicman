const logger = require('../utils/logger');

// TODO: fork this into it's own repo
const { MpdClient } = require('../../../common/mpd/MpdClient');

const connectMpd = ({ port, host }) =>
  new Promise((resolve, reject) => {
    const mpdClient = MpdClient.connect({ port, host });

    mpdClient.on('error', err => {
      logger.error('MPD ERROR', err);
      reject(err);
    });

    mpdClient.on('ready', async () => resolve(mpdClient));
  });

const getCurrentSong = async mpdClient => {
  const currentSong = await mpdClient.sendCommandAsync('currentsong');
  const status = await mpdClient.sendCommandAsync('status');
  return status.state === 'play' ? currentSong : false;
};

module.exports = { connectMpd, getCurrentSong };
