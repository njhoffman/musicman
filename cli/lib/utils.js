const { promisify } = require('util');
const { stat } = require('fs');
const glob = require('glob');
// const mm = require('music-metadata');
const NodeID3 = require('node-id3');

const checkDirectory = async dir => promisify(stat)(dir);

const getFiles = async (dir, options = { ext: '*', recursive: false }) => {
  const { recursive, ext } = options;
  const globPath = recursive ? `${dir}/**/*.${ext}` : `${dir}/*.${ext}`;
  const files = await promisify(glob)(globPath);
  return files;
};

// const getMetadata = async files => {
//   const results = await Promise.all(files.map(async file => Promise.all([file, mm.parseFile(file)])));
//   const parsed = results.map(([fileName, metadata]) => ({
//     fileName,
//     ...metadata.common,
//     // TODO : make this a custom function
//     stars: metadata.common.rating ? mm.ratingToStars(metadata.common.rating[0].rating) : ''
//   }));
//   return parsed;
// };

const readMetadata = file =>
  new Promise((resolve, reject) => {
    console.log('READING', file);
    NodeID3.read(file, (err, tags) => {
      console.log('FINISHED', err, tags);
      resolve(tags);
    });
  });

const getMetadata = async files => {
  console.log('GETTING METADATA');
  const results = await Promise.all(files.map(async file => Promise.all([file, readMetadata(file)])));
  return results;
};

module.exports = { getFiles, checkDirectory, getMetadata };
