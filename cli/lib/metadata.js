const { writeFiles } = require('./metadata/write');
const { getMetadata, parseMetadata } = require('./metadata/read');
const { filterFiles } = require('./metadata/filter');

module.exports = {
  filterFiles,
  getMetadata,
  parseMetadata,
  writeFiles
};
