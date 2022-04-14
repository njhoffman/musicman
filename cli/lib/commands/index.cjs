const viewCommand = require('./view.cjs');
const editCommand = require('./edit.cjs');
const playlistCommand = require('./playlist.cjs');
const statsCommand = require('./stats.cjs');

module.exports = [viewCommand, editCommand, playlistCommand, statsCommand];
