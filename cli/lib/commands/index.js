const viewCommand = require('./view.js');
const editCommand = require('./edit.js');
const playlistCommand = require('./playlist.js');
const statsCommand = require('./stats.js');
const dbCommand = require('./db.js');
const searchCommand = require('./search.js');
const syncCommand = require('./sync.js');
const sortCommand = require('./sort.js');
const logsCommand = require('./logs.js');
const undoCommand = require('./undo.js');
const menuCommand = require('./menu.js');
const shuffleCommand = require('./shuffle.js');
const spotifyCommand = require('./spotify.js');
const playerCommand = require('./player.js');
const checkCommand = require('./check.js');
const statusCommand = require('./status.js');
const uiCommand = require('./ui.js');
const valuesCommand = require('./values.js');
const analyzeCommand = require('./analyze.js');

module.exports = [
  viewCommand,
  editCommand,
  playlistCommand,
  statsCommand,
  valuesCommand,
  dbCommand,
  searchCommand,
  syncCommand,
  sortCommand,
  logsCommand,
  undoCommand,
  menuCommand,
  shuffleCommand,
  spotifyCommand,
  playerCommand,
  checkCommand,
  statusCommand,
  uiCommand,
  analyzeCommand
];
