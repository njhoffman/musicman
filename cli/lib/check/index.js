const _ = require('lodash');
const path = require('path');
const { excludedPaths } = require('../db/exclusions.js');

const library = require('./library.js');
const { exclusive } = require('./playlists.js');
const { fileChecks } = require('./files.js');

/**
 * The checks of musicman check, in report order. db checks query the library database, files checks
 * read the files. unit names what a finding is, for the summary.
 */
const checks = [
  { name: 'drift', source: 'files', unit: 'file', description: 'database and files differ' },
  {
    name: 'unreadable',
    source: 'files',
    unit: 'file',
    description: 'files that cannot be read or rewritten'
  },
  { name: 'frames', source: 'files', unit: 'file', description: 'frames a tag rewrite would lose' },
  {
    name: 'names',
    source: 'db',
    unit: 'group',
    description: 'custom field names that differ only by case or punctuation',
    run: library.names
  },
  {
    name: 'standard',
    source: 'db',
    unit: 'field',
    description: 'custom fields that duplicate a standard frame',
    run: library.standard
  },
  {
    name: 'spotify-id',
    source: 'db',
    unit: 'file',
    description: `leftover ${library.leftoverSpotifyFrame} frames`,
    run: library.spotifyId
  },
  {
    name: 'multi',
    source: 'files',
    unit: 'value',
    description: 'multi value fields with empty, padded, or repeated items'
  },
  {
    name: 'case',
    source: 'db',
    unit: 'group',
    description: 'multi value field values that differ only in case',
    run: library.caseVariants
  },
  {
    name: 'rare',
    source: 'db',
    unit: 'value',
    description: 'context, mood, and picks values only a few songs have',
    run: library.rare
  },
  {
    name: 'rating',
    source: 'db',
    unit: 'file',
    description: 'ratings off the half step scale',
    run: library.rating
  },
  {
    name: 'encoding',
    source: 'db',
    unit: 'value',
    description: 'text that looks garbled by a wrong encoding',
    run: library.encoding
  },
  {
    name: 'duplicates',
    source: 'db',
    unit: 'group',
    description: 'the same song in more than one file',
    run: library.duplicates
  },
  {
    name: 'artwork',
    source: 'db',
    unit: 'file',
    description: 'songs without an embedded cover',
    run: library.artwork
  },
  {
    name: 'exclusive',
    source: 'db',
    unit: 'song',
    description: 'songs in more than one rating or grouping playlist',
    run: exclusive
  }
];

const checkNames = _.map(checks, 'name');

// the checks to run: those named in only (comma separated), else all; throws for an unknown name
const selectChecks = only => {
  if (!only) {
    return checks;
  }
  const wanted = _.compact(_.map(`${only}`.split(','), name => _.toLower(_.trim(name))));
  const unknown = _.difference(wanted, checkNames);
  if (unknown.length) {
    throw new Error(`Unknown check ${unknown.join(', ')}; checks are ${checkNames.join(', ')}`);
  }
  return _.filter(checks, ({ name }) => wanted.includes(name));
};

/**
 * Runs checks over the songs under target: the database checks on db, the file checks on the mp3 files
 * found under target (listFiles). Resolves to [{ name, description, unit, findings }] in report order.
 */
const runChecks = async ({ db, config, target, selected, listFiles, onProgress }) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const scope = path.relative(baseDirectory, path.resolve(target));
  if (scope.startsWith('..') || path.isAbsolute(scope)) {
    throw new Error(`Target ${target} is not inside mpd.baseDirectory ${baseDirectory}`);
  }
  const songs = db
    .prepare('SELECT id, path, mtime, size, duration, mb_track_id FROM songs ORDER BY path')
    .all()
    .filter(({ path: song }) => !scope || song === scope || song.startsWith(`${scope}/`));
  const results = {};
  const fromDb = _.filter(selected, { source: 'db' });
  if (fromDb.length) {
    library.withScope(db, songs, () =>
      _.each(fromDb, check => {
        results[check.name] = check.run({ db, config, songs });
      })
    );
  }
  const fromFiles = _.map(_.filter(selected, { source: 'files' }), 'name');
  const excluded = fromFiles.length ? excludedPaths(db) : new Set();
  if (fromFiles.length) {
    Object.assign(
      results,
      await fileChecks({
        songs,
        // excluded songs (duplicate copies kept on disk) are not drift
        files: _.reject(listFiles(path.resolve(target)), file =>
          excluded.has(path.relative(baseDirectory, file))
        ),
        baseDirectory,
        config,
        wanted: fromFiles,
        onProgress
      })
    );
  }
  return _.map(selected, ({ name, description, unit }) => ({
    name,
    description,
    unit,
    findings: results[name] || []
  }));
};

module.exports = { checkNames, checks, runChecks, selectChecks };
