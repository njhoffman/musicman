const _ = require('lodash');
const { version } = require('../../package.json');
const tags = require('./tags');

module.exports = {
  version,
  env: process.env.NODE_ENV,
  mpd: {
    port: 6600,
    host: 'localhost'
  },
  library: {
    tagId: 'ID3v2.4',
    tags: _.map([
      'popularity',
      'volume',
      'artist',
      'title',
      'year',
      'genre',
      'mood',
      'copyright',
      'album'
    ], name => _.find(tags, { name })),
    basePath: '/home/nicholas/Music'
  },
  server: {
    port: 3000
  },
  logger: {
    colors: {
      fatal: { fg: [255, 255, 255], bg: [230, 20, 20] },
      error: { fg: [255, 255, 255], bg: [180, 20, 20] },
      warn: { fg: [255, 255, 255], bg: [180, 60, 20] },
      log: { fg: [255, 255, 255], bg: [60, 110, 180] },
      info: { fg: [255, 255, 255], bg: [20, 70, 180] },
      debug: { fg: [255, 255, 255], bg: [80, 100, 200] },
      trace: { fg: [255, 255, 255], bg: [80, 120, 220] }
    },
    file: {
      name: 'musicman.log',
      level: 3
    },
    stdout: {
      level: 5
    }
  },
};
