const _ = require('lodash');
const { checkExists, getFiles, getMetadata, parseFileMetadata } = require('../utils');

const parseOptions = (options, files) => {
  if (/^\d+(?:.\d+)?$/.test(options[0])) {
    console.log('RATING');
  }
  // console.log('OPTIONS', options, files);
};

const editCommand = async ({ target, options, config }) => {
  console.log('Edit command', options, target);
  const exists = checkExists(target);
  const files = exists.isDirectory() ? await getFiles(target, { ext: 'mp3', recursive: true }) : target;
  const filesMetadata = await getMetadata(files);
  const metadata = _.map(parseFileMetadata(filesMetadata), ([file, meta]) => meta);
  const parsedOptions = parseOptions(options, metadata);
  console.log('parsedOptions', parsedOptions);
};

module.exports = { name: 'edit', func: editCommand };
