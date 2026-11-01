const _ = require('lodash');

// "key: value" lines of an MPD reply; only the first ": " separates, values (titles, paths, times) can hold more
const parseMpdReply = text =>
  _.fromPairs(
    _.compact(
      _.map(String(text).split('\n'), line => {
        const at = line.indexOf(': ');
        return at > 0 ? [line.slice(0, at), line.slice(at + 2)] : null;
      })
    )
  );

const argEscape = arg =>
  // MPD arguments are double quoted with backslashes and double quotes escaped
  `"${arg.toString().replace(/[\\"]/g, '\\$&')}"`;
module.exports = { parseMpdReply, argEscape };
