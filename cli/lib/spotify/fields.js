const _ = require('lodash');

// frames every matched song gets, outside the configurable spotify.fields mapping
const trackIdName = 'sp_track_id';
const fetchedAtName = 'sp_fetched_at';

// objects a field path can start with: the track, its full album, and its first artist
const sources = ['track', 'album', 'artist'];

// Web API batch sizes for the several tracks, albums, and artists endpoints
const batchSizes = { track: 50, album: 20, artist: 50 };

const fieldDefinitions = config => _.get(config, 'spotify.fields', []);

// sources other than the track that a field needs, each costs batched requests
const neededSources = config =>
  _.uniq(_.map(fieldDefinitions(config), ({ path }) => path.split('.')[0])).filter(
    source => source !== 'track'
  );

/**
 * Values at a field path like track.artists[].name, where [] collects every item of an array.
 * Nulls, empty strings, and empty arrays are left out.
 */
const valuesAt = (objects, fieldPath) => {
  const [source, ...segments] = fieldPath.split('.');
  let current = objects[source] === undefined || objects[source] === null ? [] : [objects[source]];
  segments.forEach(segment => {
    const key = segment.replace(/\[\]$/, '');
    const values = _.map(current, value => _.get(value, key));
    current = segment.endsWith('[]') ? _.flatten(_.filter(values, _.isArray)) : values;
  });
  return _.filter(current, value => !_.isNil(value) && value !== '' && !_.isObject(value));
};

// every path with a value in an object, arrays written as [] like field paths
const leafPaths = (value, prefix) => {
  if (_.isArray(value)) {
    return _.uniq(_.flatMap(value, item => leafPaths(item, `${prefix}[]`)));
  }
  if (_.isPlainObject(value)) {
    return _.flatMap(_.keys(value), key => leafPaths(value[key], `${prefix}.${key}`));
  }
  return _.isNil(value) ? [] : [prefix];
};

// ignore entries with a dot are path prefixes (album.tracks), others are keys ignored anywhere (href)
const isIgnored = (fieldPath, ignore) =>
  _.some(ignore, entry => {
    if (entry.includes('.')) {
      return (
        fieldPath === entry ||
        (fieldPath.startsWith(entry) && /^[.[]/.test(fieldPath.slice(entry.length)))
      );
    }
    return _.some(fieldPath.split('.'), segment => segment.replace(/\[\]$/, '') === entry);
  });

const formatValue = (values, { multi, separator = ', ' }, tagName) => {
  const unique = _.uniq(_.map(values, String));
  // a year fallback takes the year of a release date like 1997-05-28
  if (tagName === 'year') {
    return unique[0].slice(0, 4);
  }
  return unique.join(multi ? ',' : separator);
};

/**
 * Tag values for a matched track from objects { track, album, artist } (album and artist are the full
 * Web API objects, either may be missing). Returns the custom fields to write as TXXX.<name>, the
 * standard tags to fill when they are empty, and the response paths no field or ignore entry covers.
 */
const assignFields = (objects, config, now = new Date()) => {
  const custom = [
    { name: trackIdName, value: objects.track.id },
    { name: fetchedAtName, value: now.toISOString() }
  ];
  const fallbacks = [];
  _.each(fieldDefinitions(config), field => {
    const values = valuesAt(objects, field.path);
    if (values.length === 0) {
      return;
    }
    custom.push({ name: field.name, value: formatValue(values, field) });
    if (field.fallback) {
      fallbacks.push({
        name: field.fallback,
        value: formatValue(values, _.omit(field, 'multi'), field.fallback)
      });
    }
  });
  const mapped = new Set(_.map(fieldDefinitions(config), 'path').concat('track.id'));
  const ignore = _.get(config, 'spotify.ignore', []);
  const unassigned = _.filter(
    _.flatMap(sources, source => (objects[source] ? leafPaths(objects[source], source) : [])),
    fieldPath => !mapped.has(fieldPath) && !isIgnored(fieldPath, ignore)
  );
  return { custom, fallbacks, unassigned };
};

/**
 * Full Web API objects { track, album, artist } for track ids, keyed by track id. Tracks already known
 * (from a search) are not requested again; albums and artists are only requested when a field needs
 * them, each id once.
 */
const fetchDetails = async (client, trackIds, config, known = new Map()) => {
  const batches = async (type, ids) => {
    const found = new Map();
    const chunks = _.chunk(_.uniq(_.compact(ids)), batchSizes[type]);
    for (const chunk of chunks) {
      const response = await client.get(`/${type}s?ids=${chunk.join(',')}`);
      _.each(_.compact(response[`${type}s`]), item => found.set(item.id, item));
    }
    return found;
  };
  const tracks = new Map(known);
  const fetched = await batches(
    'track',
    _.filter(trackIds, id => !tracks.has(id))
  );
  fetched.forEach((track, id) => tracks.set(id, track));

  const needed = neededSources(config);
  const albums = needed.includes('album')
    ? await batches('album', _.map([...tracks.values()], 'album.id'))
    : new Map();
  const artists = needed.includes('artist')
    ? await batches('artist', _.map([...tracks.values()], 'artists[0].id'))
    : new Map();

  return new Map(
    _.compact(
      _.map(trackIds, id => {
        const track = tracks.get(id);
        return track
          ? [
              id,
              {
                track,
                album: albums.get(_.get(track, 'album.id')),
                artist: artists.get(_.get(track, 'artists[0].id'))
              }
            ]
          : null;
      })
    )
  );
};

module.exports = {
  assignFields,
  fetchDetails,
  fetchedAtName,
  fieldDefinitions,
  isIgnored,
  leafPaths,
  trackIdName,
  valuesAt
};
