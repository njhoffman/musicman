const { promisify } = require('util');
const fs = require('fs');

const crawlDirectory = async (directoryPath) => promisify(fs.readdir)(directoryPath);

module.exports = { crawlDirectory };

