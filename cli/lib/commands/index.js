const viewCommand = require('./view.js');
const editCommand = require('./edit.js');
const playlistCommand = require('./playlist.js');
const statsCommand = require('./stats.js');
const dbCommand = require('./db.js');

module.exports = [viewCommand, editCommand, playlistCommand, statsCommand, dbCommand];
