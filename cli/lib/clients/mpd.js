const Promise = require('bluebird');
const logger = require('../utils/logger.js');

// TODO: fork this into it's own repo
const { MpdClient } = require('musicman-common/mpd/MpdClient.js');

const connectMpd = ({ port, host }, { timeout = 2000 } = {}) =>
  new Promise((resolve, reject) => {
    const mpdClient = MpdClient.connect({ port, host });

    // an unreachable host never errors on its own, give up after timeout
    const timer = setTimeout(() => {
      if (mpdClient.socket) {
        mpdClient.socket.destroy();
      }
      reject(new Error(`timed out connecting to ${host}:${port}`));
    }, timeout);

    mpdClient.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    mpdClient.on('ready', async () => {
      clearTimeout(timer);
      resolve(mpdClient);
    });
  });

const getCurrentSong = async mpdClient => {
  const currentSong = await mpdClient.sendCommandAsync('currentsong');
  const status = await mpdClient.sendCommandAsync('status');
  return status.state === 'play' ? currentSong : false;
};

// current song if MPD is reachable, otherwise false so commands with explicit targets still work
const getAvailableSong = async (mpdConfig, options) => {
  let mpdClient;
  try {
    mpdClient = await connectMpd(mpdConfig, options);
    return await getCurrentSong(mpdClient);
  } catch (err) {
    logger.warn(`MPD is not available (${err.message}), continuing without the current song`);
    return false;
  } finally {
    // close the connection so the process can exit once output is flushed
    if (mpdClient && mpdClient.socket) {
      mpdClient.socket.destroy();
    }
  }
};

module.exports = { connectMpd, getAvailableSong, getCurrentSong };
