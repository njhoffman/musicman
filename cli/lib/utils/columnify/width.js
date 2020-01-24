const stripAnsi = require('strip-ansi');
const wcwidth = require('wcwidth');

module.exports = function(str) {
  return wcwidth(stripAnsi(str));
};
