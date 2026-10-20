const _ = require('lodash');
const fs = require('fs');
const NodeId3 = require('node-id3');
const mp3Duration = require('mp3-duration');
const { flatten } = require('flat');
const Promise = require('bluebird');
const { readHeaderDuration } = require('./duration.js');

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

// raw id3 frames, cover art is reduced to a presence marker so image data is not kept in memory
const toRawTags = tags => {
  const rawTags = _.omit(tags.raw, ['APIC']);
  if (_.has(tags.raw, 'APIC')) {
    rawTags.APIC = true;
  }
  return rawTags;
};

const readMetadata = file =>
  new Promise((resolve, reject) => {
    NodeId3.read(file, (err, tags) => {
      if (err) {
        reject(err);
      } else {
        resolve(toRawTags(tags));
      }
    });
  });

const readMetadataFull = file =>
  new Promise((resolve, reject) => {
    readDuration(file).then(duration => {
      readSize(file).then(size => {
        NodeId3.read(file, (err, tags) => {
          if (err) {
            reject(err);
          } else {
            const rawTags = toRawTags(tags);
            rawTags.duration = duration;
            rawTags.size = size;
            resolve(rawTags);
          }
        });
      });
    });
  });

// read metadata tags for files array and return [file, metadata]
const getMetadata = async files =>
  Promise.map(
    [].concat(files),
    async (file, i) => {
      process.stdout.write(` ...${i} files left\r`);
      return Promise.all([file, readMetadata(file)]);
    },
    { concurrency: 5 }
  );

// read metadata tags, duration and size for files array
const getMetadataFull = async files =>
  Promise.map(
    [].concat(files),
    async (file, i) => {
      process.stdout.write(` ...${i} files left\r`);
      return Promise.all([file, readMetadataFull(file)]);
    },
    { concurrency: 5 }
  );

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

module.exports = { getMetadata, getMetadataFull, parseMetadata };
