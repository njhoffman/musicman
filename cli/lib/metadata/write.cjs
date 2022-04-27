const _ = require('lodash');
const NodeId3 = require('node-id3');
const { unflatten } = require('flat');

const logger = require('../utils/logger.cjs');

const toRating = (newRating, ratingMax) => Math.round((newRating * 255) / ratingMax);

const prepareRating = (rating, { min, max, email }) => (rating === '' ? {} : { email, rating: toRating(rating, max) });

const prepareCustomFields = txxxFields =>
  _.map(_.keys(txxxFields), txKey => ({
    description: txKey,
    value: txxxFields[txKey]
  }));

// transform new metadata to id3 keys for saving
const prepareId3Tags = config => ([file, fields]) => {
  const filteredTags = _.pick(fields, _.map(config.tags, 'name'));
  const editTags = _.mapKeys(filteredTags, (value, name) => _.find(config.tags, { name }).id);

  // special rating handler
  if (_.isString(fields.rating)) {
    editTags[config.rating.tag] = prepareRating(fields.rating, config.rating);
  }

  const finalTags = unflatten(editTags);

  // special TXXX keys handler
  finalTags.TXXX = prepareCustomFields(finalTags.TXXX);

  return [file, finalTags];
};

const mergeAssignments = (meta, assignments) => {
  const parsedAssignments = _.mapValues(assignments, (val, key) => {
    let parsedVal = val;
    if (_.isArray(parsedVal)) {
      // handle differently if aggregate fields, i.e. '+field1,-field2'
      const isAggregate = _.some(val, valItem => /^[+-]/.test(valItem));
      if (isAggregate) {
        const existingVals = _.isUndefined(meta[key]) ? [] : `${meta[key]}`.split(',');

        const toAdd = _.map(val, aggregateVal =>
          /^\+/.test(aggregateVal) ? aggregateVal.replace(/^\+/, '') : false
        ).filter(Boolean);

        const toRemove = _.map(val, aggregateVal =>
          /^-/.test(aggregateVal) ? aggregateVal.replace(/^-/, '') : false
        ).filter(Boolean);

        // only include case-insensitive unique items that are added (+) or existed and not removed (-)
        parsedVal = toAdd.concat(
          _.filter(
            existingVals,
            existingVal => !_.some(toRemove, removeVal => _.toLower(removeVal) === _.toLower(existingVal))
          )
        );
      }
      return _.uniqBy(parsedVal, _.toLower);
    }
    return parsedVal;
  });
  return { ...meta, ...parsedAssignments };
};

const writeFile = ([file, id3Tags]) => {
  logger.debug(`Writing file: ${file}\nWith Tags:`, id3Tags);
  return NodeId3.update(id3Tags, file);
};

const writeFiles = config => files => {
  return _.chain(files)
    .map(prepareId3Tags(config))
    .map(writeFile)
    .value();
};

module.exports = { mergeAssignments, writeFiles };
