const glob = require('glob');
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
    const globPath = (recursive ? `${dir}/**/*.${ext}` : `${dir}/*.${ext}`)
      .replace('[', '\\[')
      .replace(']', '\\]');

    const files = glob.sync(globPath);
    return files;
  }
  return null;
};

module.exports = {
  checkExists,
  getFiles
};
