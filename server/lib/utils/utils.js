const { promisify } = require('util');
const fs = require('fs');

const crawlDirectory = async directoryPath => promisify(fs.readdir)(directoryPath);

const isJson = str => {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
};

module.exports = { crawlDirectory, isJson };
