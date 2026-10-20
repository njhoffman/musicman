const { writeFiles, mergeAssignments } = require('./metadata/write.js');
const { getMetadata, getMetadataFull, parseMetadata } = require('./metadata/read.js');
const { filterFiles } = require('./metadata/filter.js');

module.exports = {
  filterFiles,
  getMetadata,
  getMetadataFull,
  parseMetadata,
  writeFiles,
  mergeAssignments
};
