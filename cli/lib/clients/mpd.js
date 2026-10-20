const _ = require('lodash');
const Promise = require('bluebird');
const { MpdClient, cmd } = require('musicman-common/mpd/MpdClient.js');
const logger = require('../utils/logger.js');

// TODO: fork this into it's own repo

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

// commands per MPD command list, well under MPD's default max_command_list_size
const commandListSize = 500;

/**
 * Adds songs (paths relative to the MPD music directory) to the queue. With replace the queue is
 * cleared first and playback starts with the new songs.
 */
const queueSongs = async (mpdConfig, songPaths, { replace = false } = {}) => {
  const mpdClient = await connectMpd(mpdConfig);
  try {
    const adds = songPaths.map(songPath => cmd('add', [songPath]));
    const commands = replace ? [cmd('clear', []), ...adds, cmd('play', [])] : adds;
    await Promise.each(_.chunk(commands, commandListSize), chunk =>
      mpdClient.sendCommandListAsync(chunk)
    );
    return songPaths.length;
  } finally {
    mpdClient.socket.destroy();
  }
};

module.exports = { connectMpd, getAvailableSong, getCurrentSong, queueSongs };
