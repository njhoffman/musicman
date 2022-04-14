const { writeFiles, mergeAssignments } = require('./metadata/write.cjs');
const { getMetadata, parseMetadata } = require('./metadata/read.cjs');
const { filterFiles } = require('./metadata/filter.cjs');

module.exports = {
  filterFiles,
  getMetadata,
  parseMetadata,
  writeFiles,
  mergeAssignments
};
