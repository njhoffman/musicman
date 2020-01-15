const _ = require('lodash');
const logger = require('../utils/logger');

const processFields = ({ options, metadata, config, utils }) => {
  const {
    metadata: { toRating }
  } = utils;

  const processed = _.map(metadata, file => {
    const newFields = { ...file };

    // if first argument is numeric, assume it's a rating
    if (/^\d+(?:.\d+)?$/.test(options[0])) {
      newFields.rating = toRating(options[0], config.rating.max);
    }

    options.forEach(option => {
      const [key, rest] = option.split(':');
      const tagConfig = _.find(config.tags, { name: key });
      if (tagConfig) {
        const tagValue = rest.split(' ')[0].replace(/"/g, '');

        if (tagConfig.multi && /[\+-]+/.test(tagValue)) {
          // multi field assignments rely on existing tag metadata
          const multiVals = file[key].split(',');
          tagValue.split(',').forEach(val => {
            if (/^\+/.test(val)) {
              // add comma separeted items prefixed with '+'
              multiVals.push(val.slice(1));
            } else if (/^-/.test(val)) {
              // remove ones prefixed with '-'from existing tags
              _.remove(multiVals, mv => val.slice(1) === mv);
            }
          });

          newFields[key] = _.uniq(multiVals)
            .filter(Boolean)
            .join(',');
        } else {
          // just assign whole string if not a multi field
          newFields[key] = tagValue;
        }
      }
    });

    return newFields;
  });

  return processed;
};

const editCommand = async ({ target, options, config, utils }) => {
  const {
    file: { checkExists, getFiles },
    metadata: { getMetadata, parseFileMetadata }
  } = utils;

  const exists = checkExists(target);
  if (!exists) {
    throw new Error(`Target does not exist: ${target}`);
  }
  const files = exists.isDirectory() ? await getFiles(target, { ext: 'mp3', recursive: true }) : target;
  const filesMetadata = await getMetadata(files);
  const metadata = _.map(parseFileMetadata(filesMetadata), ([file, meta]) => meta);
  const newFields = processFields({ options, metadata, config, utils });
  return newFields;
};

module.exports = { name: 'edit', func: editCommand };
