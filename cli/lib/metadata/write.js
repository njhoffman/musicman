const _ = require('lodash');
const NodeId3 = require('node-id3');
const { unflatten } = require('flat');

const logger = require('../utils/logger.js');
const { appendFrames, readTagBuffer, singleFrames, walkFrames } = require('../check/frames.js');
const { journaledWrite } = require('../history/journal.js');

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
    // multi value fields are stored comma separated, as they are read; node-id3 writes an array as undefined
    const filteredTags = _.mapValues(_.pick(fields, _.map(config.library.tags, 'name')), value =>
      _.isArray(value) ? value.join(',') : value
    );
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
const updateNodeId3 = (tags, file) => {
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

// a frame as node-id3 parses it on its own, from a tag holding only that frame
const parseFrame = (version, bytes) => {
  const size = bytes.length;
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    version,
    0,
    0,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f
  ]);
  return _.values(_.get(NodeId3.read(Buffer.concat([header, bytes])), 'raw', {}))[0];
};

/**
 * Frames of a single frame id (singleFrames) that appear more than once in a tag, except the one
 * node-id3 reads (parsed raw) and exact copies of it: those a node-id3 rewrite drops.
 */
const droppedRepeats = (tag, frames, raw) =>
  _.flatMap(
    _.filter(_.groupBy(frames, 'id'), (group, id) => singleFrames.has(id) && group.length > 1),
    group => {
      const parsed = _.map(group, ({ start, end }) => parseFrame(tag[3], tag.subarray(start, end)));
      const read = raw[group[0].id];
      let kept = _.findIndex(parsed, value => _.isEqual(value, read));
      kept = kept === -1 ? 0 : kept;
      return _.filter(
        group,
        (frame, index) => index !== kept && !_.isEqual(parsed[index], parsed[kept])
      );
    }
  );

const keepingFrames = (file, write) => {
  const original = readTagBuffer(file);
  const frames = walkFrames(original) || [];
  const raw = _.get(NodeId3.read(original || Buffer.alloc(0)), 'raw', {});
  const known = new Set(_.keys(raw));
  const unknown = _.filter(frames, ({ id }) => !known.has(id));
  const dropped = droppedRepeats(original, frames, raw);
  const kept = _.sortBy([...unknown, ...dropped], 'start');
  const result = write();
  if (result instanceof Error || kept.length === 0) {
    return result;
  }
  // node-id3 writes ID3v2.3, so frames of an ID3v2.3 tag are copied as they are
  if (
    original[3] !== 3 ||
    !appendFrames(
      file,
      _.map(kept, ({ start, end }) => original.subarray(start, end)),
      { last: _.uniq(_.map(dropped, 'id')) }
    )
  ) {
    return new Error(
      `tags were written, but ${_.uniq(_.map(kept, 'id')).join(', ')} could not be kept`
    );
  }
  return result;
};

/**
 * Runs a node-id3 write of file, keeping the frames node-id3 does not understand and would drop when it
 * rewrites the tag (e.g. TCMP, IPLS, TSOC), and the second and later frames of an id it holds only once
 * (droppedRepeats, e.g. a comment next to iTunNORM): their original bytes are appended to the new tag. The frames
 * it changes are recorded for musicman undo when a run is being recorded. Returns what write returned
 * (true or an Error).
 */
const keepingUnknownFrames = (file, write) =>
  journaledWrite(file, () => keepingFrames(file, write));

/**
 * Tags written to a file with node-id3 update (added or changed, nothing removed), keeping the frames
 * node-id3 does not understand. Returns true, or the Error node-id3 returned.
 */
const updateTags = (tags, file) => keepingUnknownFrames(file, () => updateNodeId3(tags, file));

/**
 * Rewrites the whole tag of a file from its node-id3 raw frames after change(raw), e.g. to remove TXXX
 * fields, which update cannot do. Frames node-id3 does not understand are kept, and UFID frames without
 * an identifier are written with an empty one. Returns true, or the Error node-id3 returned.
 */
const rewriteTags = (file, change) =>
  keepingUnknownFrames(file, () => {
    const { raw = {} } = NodeId3.read(file) || {};
    const changed = change(_.cloneDeep(raw)) || raw;
    if (changed.UFID) {
      changed.UFID = _.map([].concat(changed.UFID), frame => ({
        ...frame,
        identifier: frame.identifier || Buffer.alloc(0)
      }));
    }
    return NodeId3.write(changed, file);
  });

const writeFile = ([file, id3Tags]) => {
  logger.debug(`Writing file: ${file}\nWith Tags:`, id3Tags);
  return updateTags(id3Tags, file);
};

const writeFiles = config => files => {
  return _.chain(files).map(prepareId3Tags(config)).map(writeFile).value();
};

module.exports = { mergeAssignments, prepareRating, rewriteTags, updateTags, writeFiles };
