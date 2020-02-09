const path = require('path');
const { exec } = require('child_process');

const config = require('../config');
const logger = require('./utils/logger');
const { getCurrentSong, connectMpd } = require('./clients/mpd');
const { getMetadata, parseMetadata } = require('./metadata');

const getSongInfo = async mpdClient => {
  const currentSong = await getCurrentSong(mpdClient);
  if (currentSong.file) {
    const target = path.join(config.mpd.baseDirectory, currentSong.file);
    const metadata = await getMetadata(target);
    return parseMetadata(metadata[0][1], config);
  }
  return false;
};

const sendNotification = song => {
  const { bin, icon, duration, urgency, fields } = config.daemon;

  // transfered data is handled in the callback function
  const title = `${song.rating || '*UNRATED*'}   ${song.title}`;
  const details = fields.map(field => song[field]);

  const args = [`--urgency=${urgency}`, icon ? `--icon=${icon}` : '', `--expire-time=${duration}`];

  const msg = [
    `Sending notification: `,
    `${args.filter(Boolean).join('\n\t')}`,
    `"${title}"`,
    `"${details.filter(Boolean).join('\n\t')}"`
  ];
  logger.debug(msg.join('\n\t'));

  exec(`${bin} ${args.join(' ')} "${title}" "${details.join('\n')}"`);
};

const run = async args => {
  const mpdClient = await connectMpd(config.mpd);
  const song = await getSongInfo(mpdClient);
  if (song) {
    sendNotification(song);
  }

  mpdClient.on('system', async name => {
    if (name === 'player') {
      const newSong = await getSongInfo(mpdClient);
      if (newSong) {
        sendNotification(newSong);
      }
    }
  });
};

run(process.argv.slice(2));
