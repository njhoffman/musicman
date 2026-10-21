const _ = require('lodash');
const fs = require('fs');
const NodeId3 = require('node-id3');
const globalTags = require('musicman-common/config/tags.json');

const { assignFields, fetchDetails } = require('../spotify/fields.js');
const { execBeet } = require('../beets/sort.js');
const { downloadTrackId } = require('./download.js');

// frame of a tag name, user tags first like library.tags
const tagFrame = (config, name) =>
  _.get(_.find(config.tags || [], { name }) || _.find(globalTags, { name }), 'id');

// current value of a frame in raw node-id3 tags, custom fields by TXXX.<description>
const rawValue = (raw, frame) => {
  if (frame.startsWith('TXXX.')) {
    const description = frame.slice(5);
    return _.get(_.find([].concat(raw.TXXX || []), { description }), 'value');
  }
  return raw[frame];
};

/**
 * Tags written to a download: the Spotify fields (when the track details could be fetched), standard
 * tags the file has no value for, and the tags of the playlists the manifest track is in. Returns
 * { custom, filled, playlist } with frame ids, and the response paths no field covers.
 */
const importTags = ({ raw, entry, objects, config, now }) => {
  const assignment = objects
    ? assignFields(objects, config, now)
    : { custom: [{ name: 'sp_track_id', value: entry.trackId }], fallbacks: [], unassigned: [] };
  const filled = _.compact(
    _.map(assignment.fallbacks, ({ name, value }) => {
      const frame = tagFrame(config, name);
      return frame && !rawValue(raw, frame) ? { name, frame, value } : null;
    })
  );
  // playlist tags (grouping:IndieRock.Artists, context:Study) are what places the song in its playlists
  const playlist = _.compact(
    _.map(entry.tags, (value, name) => {
      const frame = tagFrame(config, name);
      return frame ? { name, frame, value: [].concat(value).join(',') } : null;
    })
  );
  return {
    custom: assignment.custom,
    filled,
    playlist,
    unassigned: assignment.unassigned
  };
};

const writeImportTags = (file, { custom, filled, playlist }) => {
  const frames = [...filled, ...playlist];
  NodeId3.update(
    {
      userDefinedText: [
        ..._.map(custom, ({ name, value }) => ({ description: name, value })),
        ..._.map(
          _.filter(frames, ({ frame }) => frame.startsWith('TXXX.')),
          ({ frame, value }) => ({
            description: frame.slice(5),
            value
          })
        )
      ],
      ..._.fromPairs(
        _.map(
          _.reject(frames, ({ frame }) => frame.startsWith('TXXX.')),
          ({ frame, value }) => [frame, value]
        )
      )
    },
    file
  );
};

// files beets imported as-is (no MusicBrainz match) or skipped, from its import log lines
const parseBeetsLog = text =>
  _.groupBy(
    _.compact(
      _.map(`${text || ''}`.split('\n'), line => {
        const match = line.match(/^(asis|skip|duplicate-replace|duplicate-skip)\s+(.+)$/);
        return match ? { action: match[1], file: match[2].split('; ')[0] } : null;
      })
    ),
    'action'
  );

/**
 * Tags downloaded files with their manifest track (Spotify fields, empty standard tags, playlist tags)
 * and imports them into the library with beets as singletons. Files without a track id, or whose track
 * is not in the manifest, are left alone. Without track details (e.g. rate limited), files still get
 * their id and playlist tags; sync --match fills their Spotify fields later. With dryRun nothing is
 * written and beets is not run. Imported tracks are marked importedAt in the manifest.
 */
const importDownloads = async ({
  config,
  client,
  manifest,
  files,
  beetsLog,
  dryRun = false,
  now = new Date(),
  runBeet = execBeet,
  readTags = file => NodeId3.read(file).raw || {},
  onFile = _.noop
}) => {
  const entries = _.keyBy(_.get(manifest, 'tracks', []), 'trackId');
  const found = _.map(files, file => {
    const raw = readTags(file);
    const trackId = downloadTrackId(file, raw);
    return { file, raw, trackId, entry: trackId ? entries[trackId] : null };
  });
  const unknown = _.reject(found, 'entry');
  _.each(unknown, ({ file, trackId }) =>
    onFile('unknown', { file, trackId }, trackId ? 'not in the manifest' : 'no Spotify track id')
  );
  const toImport = _.filter(found, ({ entry }) => entry && !entry.importedAt);

  let details = new Map();
  let detailsError = null;
  try {
    details = await fetchDetails(client, _.map(toImport, 'trackId'), config);
  } catch (err) {
    detailsError = err.message;
  }

  const unassigned = {};
  const tagged = _.map(toImport, item => {
    const tags = importTags({ ...item, objects: details.get(item.trackId), config, now });
    _.each(tags.unassigned, fieldPath => {
      unassigned[fieldPath] = (unassigned[fieldPath] || 0) + 1;
    });
    if (!dryRun) {
      writeImportTags(item.file, tags);
    }
    onFile('tagged', item, tags);
    return { ...item, tags };
  });

  let beets = {};
  if (!dryRun && tagged.length > 0) {
    const configArgs = config.sync.beetsConfig ? ['-c', config.sync.beetsConfig] : [];
    await runBeet([
      ...configArgs,
      'import',
      '-s',
      '-q',
      '--quiet-fallback=asis',
      '-l',
      beetsLog,
      ..._.map(tagged, 'file')
    ]);
    beets = parseBeetsLog(fs.existsSync(beetsLog) ? fs.readFileSync(beetsLog, 'utf8') : '');
    const skipped = new Set(_.map(beets.skip, 'file'));
    _.each(tagged, ({ entry, file }) => {
      if (!skipped.has(file) && !fs.existsSync(file)) {
        entry.importedAt = now.toISOString();
      }
    });
  }

  return {
    tagged: tagged.length,
    imported: _.filter(tagged, ({ entry }) => entry.importedAt).length,
    unknown: _.map(unknown, 'file'),
    asis: _.map(beets.asis, 'file'),
    skipped: _.map(beets.skip, 'file'),
    unassigned,
    detailsError,
    dryRun,
    files: _.map(tagged, ({ file, trackId, tags }) => ({
      file,
      trackId,
      fields: tags.custom.length,
      filled: _.map(tags.filled, 'name'),
      playlist: _.map(tags.playlist, ({ name, value }) => `${name}:${value}`)
    }))
  };
};

module.exports = { importDownloads, importTags, parseBeetsLog };
