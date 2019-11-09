const _ = require('lodash');
const { version } = require('../../package.json');
const tags = require('./tags');

module.exports = {
  version,
  env: process.env.NODE_ENV,
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
  }
};
