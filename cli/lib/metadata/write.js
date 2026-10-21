const _ = require('lodash');
const NodeId3 = require('node-id3');
const { unflatten } = require('flat');

const logger = require('../utils/logger.js');

const toRating = (newRating, ratingMax) => Math.round((newRating * 255) / ratingMax);

const prepareRating = (rating, { min, max, email }) =>
  rating === '' ? {} : { email, rating: toRating(rating, max) };

const prepareCustomFields = txxxFields =>
  _.map(_.keys(txxxFields), txKey => ({
    description: txKey,
    value: txxxFields[txKey]
  }));

// transform new metadata to id3 keys for saving
const prepareId3Tags =
  config =>
  ([file, fields]) => {
    const filteredTags = _.pick(fields, _.map(config.library.tags, 'name'));
    const editTags = _.mapKeys(
      filteredTags,
      (value, name) => _.find(config.library.tags, { name }).id
    );

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
            existingVal =>
              !_.some(toRemove, removeVal => _.toLower(removeVal) === _.toLower(existingVal))
          )
        );
      }
      return _.uniqBy(parsedVal, _.toLower);
    }
    return parsedVal;
  });
  return { ...meta, ...parsedAssignments };
};

/**
 * NodeId3.update, working around node-id3 failing to write a UFID frame without an identifier (e.g. an
 * empty MusicBrainz UFID): it reads one as an undefined identifier and cannot serialize that back, so
 * every update of such a file fails. Those files are first written without UFID frames, then updated
 * with them given back with empty identifiers, which keeps the frames as they were.
 */
const updateTags = (tags, file) => {
  const { raw = {} } = NodeId3.read(file) || {};
  const ufid = [].concat(raw.UFID || []);
  if (!_.some(ufid, ({ identifier }) => identifier === undefined)) {
    return NodeId3.update(tags, file);
  }
  const withoutUfid = NodeId3.write(_.omit(raw, 'UFID'), file);
  if (withoutUfid instanceof Error) {
    return withoutUfid;
  }
  return NodeId3.update(
    {
      ...tags,
      UFID: _.map(ufid, frame => ({ ...frame, identifier: frame.identifier || Buffer.alloc(0) }))
    },
    file
  );
};

const writeFile = ([file, id3Tags]) => {
  logger.debug(`Writing file: ${file}\nWith Tags:`, id3Tags);
  return updateTags(id3Tags, file);
};

const writeFiles = config => files => {
  return _.chain(files).map(prepareId3Tags(config)).map(writeFile).value();
};

module.exports = { mergeAssignments, updateTags, writeFiles };
