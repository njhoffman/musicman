const fs = require('fs');
const path = require('path');

const directory = 'test';

const removeFile = file =>
  new Promise((resolve, reject) => {
    fs.unlink(path.join(directory, file), err => {
      if (err) {
        return reject(err);
      }
      return resolve(file);
    });
  });

const cleanDirectory = dir =>
  new Promise((resolve, reject) => {
    fs.readdir(directory, (err, files) => {
      if (err) {
        reject(err);
      }
      Promise.all(files.map(removeFile));
    });
  });

module.exports = { cleanDirectory };
