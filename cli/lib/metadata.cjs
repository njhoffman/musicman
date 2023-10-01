const { writeFiles, mergeAssignments } = require('./metadata/write.cjs');
const { getMetadata, getMetadataFull, parseMetadata } = require('./metadata/read.cjs');
const { filterFiles } = require('./metadata/filter.cjs');

module.exports = {
  filterFiles,
  getMetadata,
  getMetadataFull,
  parseMetadata,
  writeFiles,
  mergeAssignments
};
