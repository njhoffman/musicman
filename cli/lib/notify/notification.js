const path = require('path');
const { execFile: nodeExecFile } = require('child_process');

const { getCurrentSong } = require('../clients/mpd.js');
const { getMetadata, parseMetadata } = require('../metadata/read.js');
const logger = require('../utils/logger.js');

/**
 * The command and arguments that show a song change notification, from the `daemon` config: the rating
 * and title as the summary, the configured fields as the body.
 */
const buildNotification = (song, { bin, icon, duration, urgency, fields = [] }) => {
  const title = `${song.rating || '*UNRATED*'}   ${song.title}`;
  const body = fields
    .map(field => song[field])
    .filter(Boolean)
    .join('\n');
  const options = [
    `--urgency=${urgency}`,
    icon ? `--icon=${icon}` : '',
    `--expire-time=${duration}`
  ].filter(Boolean);
  return { bin, args: [...options, title, body] };
};

/**
 * Sends the notification for a song. Arguments go to the binary directly, so song metadata is never
 * interpreted by a shell; a failure is logged, not thrown.
 */
const sendNotification = (song, daemonConfig, { execFile = nodeExecFile } = {}) => {
  const { bin, args } = buildNotification(song, daemonConfig);
  logger.debug(['Sending notification:', ...args].join('\n\t'));
  execFile(bin, args, err => {
    if (err) {
      logger.error(`Failed to send notification: ${err.message}`);
    }
  });
  return { bin, args };
};

// the parsed metadata of the song MPD is playing, false when nothing is playing
const getSongInfo = async (mpdClient, config, { readMetadata = getMetadata } = {}) => {
  const currentSong = await getCurrentSong(mpdClient);
  if (!currentSong.file) {
    return false;
  }
  const metadata = await readMetadata(path.join(config.mpd.baseDirectory, currentSong.file));
  return parseMetadata(metadata[0][1], config);
};

/**
 * Notifies about the current song, then about each new one MPD reports on its player subsystem.
 */
const watchSongs = async (mpdClient, config, deps = {}) => {
  const notifyCurrent = async () => {
    const song = await getSongInfo(mpdClient, config, deps);
    if (song) {
      sendNotification(song, config.daemon, deps);
    }
  };
  await notifyCurrent();
  mpdClient.on('system', async name => {
    if (name === 'player') {
      await notifyCurrent();
    }
  });
};

module.exports = { buildNotification, getSongInfo, sendNotification, watchSongs };
