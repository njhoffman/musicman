const _ = require('lodash');
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
  if (exists.isFile()) {
    return [dir];
  } else if (exists.isDirectory()) {
    const globPath = recursive ? `${dir}/**/*.${ext}` : `${dir}/*.${ext}`;
    const files = glob.sync(globPath);
    return files;
  }
  return null;
};

module.exports = {
  checkExists,
  getFiles
};
