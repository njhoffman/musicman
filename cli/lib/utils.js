const { promisify } = require('util');
const { stat } = require('fs');
const glob = require('glob');
const mm = require('music-metadata');

const checkDirectory = async dir => promisify(stat)(dir);

const getFiles = async (dir, options = { ext: '*', recursive: false }) => {
  const { recursive, ext } = options;
  const globPath = recursive ? `${dir}/**/*.${ext}` : `${dir}/*.${ext}`;
  const files = await promisify(glob)(globPath);
  return files;
};

const getMetadata = async files => {
  const results = await Promise.all(files.map(async file => Promise.all([file, mm.parseFile(file)])));
  const parsed = results.map(([fileName, metadata]) => ({
    fileName,
    ...metadata.common,
    // TODO : make this a custom function
    stars: metadata.common.rating ? mm.ratingToStars(metadata.common.rating[0].rating) : ''
  }));
  return parsed;
};

module.exports = { getFiles, checkDirectory, getMetadata };
