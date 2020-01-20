const chalk = require('chalk');
const _ = require('lodash');
const path = require('path');
const termsize = require('term-size');

const { MpdClient } = require('../../common/mpd/MpdClient');

const { columns } = termsize();

const connectMpd = ({ port, host }) =>
  new Promise((resolve, reject) => {
    const mpdClient = MpdClient.connect({ port, host });

    mpdClient.on('error', err => {
      console.error('MPD ERROR', err);
      reject(err);
    });

    mpdClient.on('ready', async () => {
      // console.log(`\nMPD connected at ${chalk.bold(host)}:${chalk.cyan(port)}`);
      const currentSong = await mpdClient.sendCommandAsync('currentsong');
      const status = await mpdClient.sendCommandAsync('status');
      resolve(status.state === 'play' ? currentSong : false);
    });
  });

module.exports = connectMpd;
