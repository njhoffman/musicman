const path = require('path');

/**
 * Points the undo history at files that moved, so musicman undo restores them where they are now instead
 * of reporting them missing. moves are { from, to } pairs of absolute paths: tag_changes rows (keyed by
 * the absolute path written) move to the new path, and match_changes rows (keyed by song id, with the
 * library relative path shown in the undo list) show the new path. Returns the tag_changes rows moved.
 */
const relinkHistory = (db, moves, { baseDirectory } = {}) => {
  const tagChanges = db.prepare('UPDATE tag_changes SET path = ? WHERE path = ?');
  const matchChanges = baseDirectory
    ? db.prepare('UPDATE match_changes SET path = ? WHERE path = ?')
    : null;
  const relative = file => path.relative(path.resolve(baseDirectory), path.resolve(file));
  let moved = 0;
  moves.forEach(({ from, to }) => {
    if (from === to) {
      return;
    }
    moved += Number(tagChanges.run(path.resolve(to), path.resolve(from)).changes);
    if (matchChanges) {
      matchChanges.run(relative(to), relative(from));
    }
  });
  return moved;
};

module.exports = { relinkHistory };
