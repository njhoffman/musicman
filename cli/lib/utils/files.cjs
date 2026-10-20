const { escape, globSync } = require('glob');
const { statSync } = require('fs');

const checkExists = target => {
  try {
    const stat = statSync(target);
    return stat;
  } catch {
    return false;
  }
};

const getFiles = (dir, options = { ext: 'mp3', recursive: false }) => {
  const { recursive, ext } = options;
  const exists = checkExists(dir);
  if (exists && exists.isFile()) {
    return [dir];
  } else if (exists && exists.isDirectory()) {
    const globPath = recursive ? `${escape(dir)}/**/*.${ext}` : `${escape(dir)}/*.${ext}`;
    // glob no longer sorts results, keep files in path order
    return globSync(globPath).sort();
  }
  return null;
};

module.exports = {
  checkExists,
  getFiles
};
