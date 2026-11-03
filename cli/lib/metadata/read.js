const _ = require('lodash');
const fs = require('fs');
const NodeId3 = require('node-id3');
const mp3Duration = require('mp3-duration');
const { flatten } = require('flat');
const { mapLimit } = require('../utils/promise.js');
const { readHeaderDuration } = require('./duration.js');
const { readTagBufferAsync: readTagBuffer } = require('./tagBuffer.js');
const { progress, progressDone } = require('../utils/logger.js');

const readSize = file =>
  new Promise((resolve, reject) => {
    fs.stat(file, (err, stats) => {
      if (err) {
        reject(err);
      } else {
        resolve(stats.size);
      }
    });
  });

const decodeDuration = file =>
  new Promise((resolve, reject) => {
    mp3Duration(file, (err, duration) => {
      if (err) {
        reject(err);
      } else {
        resolve(duration);
      }
    });
  });

// duration from mp3 frame headers, decoding the whole file only when no frame header is found
const readDuration = async file => {
  const duration = await readHeaderDuration(file);
  return duration === null ? decodeDuration(file) : duration;
};

// raw id3 frames, cover art is reduced to a presence marker so image data is not kept in memory. node-id3
// reads the whole file and gives binary frame data (the UFID identifier, PRIV data) as slices of it, so
// such a value kept for one frame would keep the whole mp3 in memory: buffers are copied out.
const toRawTags = tags => {
  const rawTags = _.cloneDeepWith(_.omit(tags.raw, ['APIC']), value =>
    Buffer.isBuffer(value) ? Buffer.from(value) : undefined
  );
  if (_.has(tags.raw, 'APIC')) {
    rawTags.APIC = true;
  }
  return rawTags;
};

const readId3 = source =>
  new Promise((resolve, reject) => {
    NodeId3.read(source, (err, tags) => {
      if (err) {
        reject(err);
      } else {
        resolve(toRawTags(tags));
      }
    });
  });

// the raw tags of a file from its tag alone, not the audio (node-id3 given a path reads the whole
// file); a file without an ID3v2 tag at its start is left to node-id3, which looks for one anywhere
const readMetadata = async file => {
  const tag = await readTagBuffer(file);
  return readId3(tag || file);
};

// raw tags with duration and size, rejects if any of the reads fail
const readMetadataFull = async file => {
  const [duration, size, rawTags] = await Promise.all([
    readDuration(file),
    readSize(file),
    readMetadata(file)
  ]);
  return { ...rawTags, duration, size };
};

// read files with limited concurrency and return [file, result], reporting progress on stderr
const readFiles = async (files, reader) => {
  const fileList = [].concat(files);
  let done = 0;
  try {
    return await mapLimit(
      fileList,
      async file => {
        const result = await Promise.all([file, reader(file)]);
        done += 1;
        progress(`Reading ${done}/${fileList.length} files`);
        return result;
      },
      5
    );
  } finally {
    progressDone();
  }
};

// read metadata tags for files array and return [file, metadata]
const getMetadata = async files => readFiles(files, readMetadata);

// read metadata tags, duration and size for files array
const getMetadataFull = async files => readFiles(files, readMetadataFull);

const metakeysTransform = (metadata, config) =>
  _.mapKeys(metadata, (tagVal, tagKey) => {
    const tag = _.find(config.library.tags, { id: tagKey });
    return tag.name;
  });

const getRating = (rating, ratingMax) => ((rating / 255) * ratingMax).toFixed(1);

// convert id3 tag names to associated tag names in config
const parseMetadata = (rawTags = {}, config) => {
  const selectedTags = flatten(_.pick(rawTags, _.map(config.library.tags, 'id')));

  // flatten and include relevant TXXX custom tags
  _.each(rawTags.TXXX, ({ description, value }) => {
    const txName = `TXXX.${description}`;
    if (_.find(config.library.tags, { id: txName })) {
      selectedTags[txName] = value;
    }
  });

  const parsedTags = metakeysTransform(selectedTags, config);

  const ratingTag = _.get(config, 'rating.tag');
  if (rawTags[ratingTag]) {
    parsedTags.rating = getRating(rawTags[ratingTag].rating, config.rating.max);
  }

  if (rawTags.duration) {
    parsedTags.duration = rawTags.duration;
  }

  if (rawTags.size) {
    parsedTags.size = rawTags.size;
  }

  return parsedTags;
};

module.exports = {
  toRawTags,
  getMetadata,
  getMetadataFull,
  parseMetadata,
  readMetadataFull
};
