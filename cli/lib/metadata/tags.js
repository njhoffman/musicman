const _ = require('lodash');
const globalTags = require('musicman-common/config/tags.json');

// values read from the file that are not id3 frames
const nonFrameKeys = ['duration', 'size'];

// text frames count when not blank, structured frames (POPM, APIC, COMM, ...) count when present
const isPopulated = value => (_.isString(value) ? value.trim().length > 0 : !_.isNil(value));

// populated frame ids in raw tags, custom TXXX fields are identified by their description
const populatedFrames = rawTags =>
  _.uniq(
    _.flatMap(_.omit(rawTags, nonFrameKeys), (value, id) => {
      if (id === 'TXXX') {
        return _.filter([].concat(value), field => isPopulated(field.value)).map(
          ({ description }) => `TXXX.${description}`
        );
      }
      return isPopulated(value) ? [id] : [];
    })
  );

// configured tag name, then tags.json name, unmapped custom fields keep their description
const tagName = (id, config) => {
  if (id === _.get(config, 'rating.tag')) {
    return 'rating';
  }
  const configured =
    _.find(_.get(config, 'library.tags'), { id }) || _.find(_.get(config, 'tags'), { id });
  if (configured) {
    return configured.name;
  }
  if (id.startsWith('TXXX.')) {
    return `TXXX:${id.slice('TXXX.'.length)}`;
  }
  const known = _.find(globalTags, { id });
  return known ? known.name : id;
};

// number of files with each populated frame, sorted alphabetically by tag name
const countTags = (rawTagsList, config) => {
  const counts = _.countBy(_.flatMap(rawTagsList, populatedFrames));
  return _.sortBy(
    _.map(counts, (count, id) => ({ id, name: tagName(id, config), count })),
    [({ name }) => name.toLowerCase(), 'name']
  );
};

module.exports = { countTags, populatedFrames };
