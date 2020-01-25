const _ = require('lodash');

const { getFilteredFiles, saveMetadata } = require('./common');
const { outputDifferences } = require('../output');
const { checkExists } = require('../utils/files');
const logger = require('../utils/logger');

const mergeAssignment = (meta, assignments) => {
  const parsedAssignments = _.mapValues(assignments, (val, key) => {
    let parsedVal = val;
    if (_.isArray(val)) {
      // handle differently if aggregate fields, i.e. '+field1,-field2'
      const isAggregate = _.some(val, valItem => /^[+-]/.test(valItem));
      if (isAggregate) {
        const existingVals = meta[key].split(',');

        const toAdd = _.map(val, aggregateVal =>
          /^\+/.test(aggregateVal) ? aggregateVal.replace(/^\+/, '') : false
        ).filter(Boolean);

        const toRemove = _.map(val, aggregateVal =>
          /^-/.test(aggregateVal) ? aggregateVal.replace(/^-/, '') : false
        ).filter(Boolean);

        // only include unique items that are added (+) or existed and not removed (-)
        parsedVal = _.uniqBy(
          toAdd.concat(
            _.filter(
              existingVals,
              existingVal => !_.some(toRemove, removeVal => _.toLower(removeVal) === _.toLower(existingVal))
            )
          ),
          _.toLower
        );
      }
    }
    return parsedVal;
  });
  return { ...meta, ...parsedAssignments };
};

const assignMetadata = assignments => {
  return ([file, meta]) => [file, mergeAssignment(meta, assignments)];
};

const editCommand = async ({ target, options, config }) => {
  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }

  const { assignments } = options;

  const filtered = await getFilteredFiles({ target, options, config });

  // assign new metadata fields, map to Id3 tag names and save
  const newFilesMetadata = _.map(filtered, assignMetadata(assignments));

  saveMetadata(newFilesMetadata, config);

  logger.info(`${filtered.length} files updated`);

  // load new metadata for comparison
  const savedMetadata = await getFilteredFiles({ options: {}, config }, _.unzip(filtered)[0]);
  outputDifferences(_.unzip(filtered)[1], _.unzip(savedMetadata)[1]);

  return { oldFiles: filtered, newFiles: newFilesMetadata };
};

module.exports = { name: 'edit', func: editCommand };
