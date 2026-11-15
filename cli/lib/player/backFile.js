const fs = require('fs');
const os = require('os');
const path = require('path');

const logger = require('../utils/logger.js');

/**
 * The back point published for other programs (the fzx music module's header), so they need not start
 * the CLI: $XDG_RUNTIME_DIR/musicman/back (/run/user/<uid> without XDG_RUNTIME_DIR), written when player
 * play saves a back point and removed when player back restores it, or player play --main or musicman
 * shuffle forgets it. Four lines, the same as player back --peek prints: the player (mpd or spotify), the
 * artist, the title, and when it was saved (ISO 8601). See docs/09-contract.md.
 */
const backFile = (env = process.env) =>
  path.join(env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`, 'musicman', 'back');

// the lines of a back point, as the file holds them and player back --peek prints them
const peekText = point =>
  `${[point.source, point.track.artist || '', point.track.title || '', point.savedAt || ''].join('\n')}\n`;

// a back point as player back --peek --format json prints it
const peekData = point => ({
  source: point.source,
  artist: point.track.artist || '',
  title: point.track.title || '',
  savedAt: point.savedAt || null
});

/**
 * Writes the back point to the file (replaced atomically), or removes the file for null. A failure (no
 * runtime directory) is logged, never thrown: the point in the database is what player back uses.
 */
const publishBack = (point, env = process.env) => {
  const file = backFile(env);
  try {
    if (!point) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, peekText(point));
    fs.renameSync(temporary, file);
  } catch (err) {
    logger.debug(`Could not publish the back point to ${file}: ${err.message}`);
  }
};

module.exports = { backFile, peekData, peekText, publishBack };
