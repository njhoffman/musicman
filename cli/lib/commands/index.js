const viewCommand = require('./view.js');
const editCommand = require('./edit.js');
const playlistCommand = require('./playlist.js');
const statsCommand = require('./stats.js');
const dbCommand = require('./db.js');
const searchCommand = require('./search.js');
const syncCommand = require('./sync.js');
const sortCommand = require('./sort.js');

module.exports = [
  viewCommand,
  editCommand,
  playlistCommand,
  statsCommand,
  dbCommand,
  searchCommand,
  syncCommand,
  sortCommand
];
