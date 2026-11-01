const _ = require('lodash');

/**
 * Checks on the library database (song_tags holds every populated frame of every file, custom TXXX
 * frames included), so they are as current as the last db --update. Each takes { db, config, songs }
 * where songs are the songs rows checked ({ id, path, duration }), and returns findings as
 * { file, detail } (file null for findings about the library as a whole, e.g. a group of names).
 */

// a custom frame name reduced to letters and digits, lowercase: names equal this way are one field
const nameKey = frameId =>
  frameId
    .replace(/^TXXX\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// standard frames custom fields often duplicate, by nameKey
const standardFrames = {
  artist: 'TPE1',
  title: 'TIT2',
  album: 'TALB',
  albumartist: 'TPE2',
  composer: 'TCOM',
  year: 'TYER',
  date: 'TYER',
  genre: 'TCON',
  bpm: 'TBPM',
  comment: 'COMM',
  grouping: 'TIT1',
  tracknumber: 'TRCK',
  discnumber: 'TPOS',
  publisher: 'TPUB',
  label: 'TPUB',
  isrc: 'TSRC',
  copyright: 'TCOP',
  lyrics: 'USLT'
};

// the frame of the Spotify id written before sp_track_id, left behind on many files
const leftoverSpotifyFrame = 'TXXX.spotify_track_id';

// lengths within this many seconds count as the same song when artist and title match
const durationTolerance = 2;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// a temporary table of the checked song ids, so queries join it instead of passing thousands of ids
const withScope = (db, songs, fn) => {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS check_scope (id INTEGER PRIMARY KEY)');
  db.exec('DELETE FROM check_scope');
  const insert = db.prepare('INSERT INTO check_scope (id) VALUES (?)');
  db.exec('BEGIN');
  try {
    _.each(songs, ({ id }) => insert.run(id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  try {
    return fn();
  } finally {
    db.exec('DELETE FROM check_scope');
  }
};

// songs per custom frame name, among the checked songs
const customFrameCounts = db =>
  db
    .prepare(
      `SELECT t.frame_id, COUNT(DISTINCT t.song_id) AS count FROM song_tags t
       JOIN check_scope s ON s.id = t.song_id
       WHERE t.frame_id LIKE 'TXXX.%' GROUP BY t.frame_id`
    )
    .all();

/**
 * Custom field names that differ only by case or punctuation (TXXX.AlbumArtist, TXXX.ALBUM ARTIST), one
 * finding per group with the songs of each spelling; the most used spelling is suggested.
 */
const names = ({ db }) => {
  const groups = _.filter(
    _.groupBy(customFrameCounts(db), ({ frame_id: id }) => nameKey(id)),
    group => group.length > 1
  );
  return _.map(
    _.orderBy(groups, group => _.sumBy(group, 'count'), 'desc'),
    group => {
      const ordered = _.orderBy(group, ['count', 'frame_id'], ['desc', 'asc']);
      const spellings = _.map(ordered, ({ frame_id: id, count }) => `${id.slice(5)} (${count})`);
      return {
        file: null,
        detail: `${spellings.join(' / ')}  ->  ${ordered[0].frame_id.slice(5)}`,
        frames: _.map(ordered, 'frame_id')
      };
    }
  );
};

/**
 * Custom fields that duplicate a standard frame (TXXX.Comment for COMM, TXXX.ALBUMARTIST for TPE2), with
 * how many of their songs have the standard frame as well.
 */
const standard = ({ db }) =>
  _.compact(
    _.map(customFrameCounts(db), ({ frame_id: id, count }) => {
      const frame = standardFrames[nameKey(id)];
      if (!frame) {
        return null;
      }
      const both = db
        .prepare(
          `SELECT COUNT(DISTINCT c.song_id) AS count FROM song_tags c
           JOIN check_scope s ON s.id = c.song_id
           JOIN song_tags f ON f.song_id = c.song_id AND f.frame_id = ?
           WHERE c.frame_id = ?`
        )
        .get(frame, id).count;
      return {
        file: null,
        detail: `${id.slice(5)} duplicates ${frame}: ${plural(count, 'song')}, ${both} with ${frame} too`,
        frame: id,
        standard: frame,
        count
      };
    })
  ).sort((a, b) => b.count - a.count);

// files still holding the Spotify id frame written before sp_track_id
const spotifyId = ({ db }) =>
  _.map(
    db
      .prepare(
        `SELECT DISTINCT songs.path FROM song_tags t
         JOIN check_scope s ON s.id = t.song_id JOIN songs ON songs.id = t.song_id
         WHERE t.frame_id = ? ORDER BY songs.path`
      )
      .all(leftoverSpotifyFrame),
    ({ path: file }) => ({ file, detail: leftoverSpotifyFrame })
  );

// values of the multi value fields that differ only in case across the library (mood:mellow, Mellow)
const caseVariants = ({ db, config }) => {
  const fields = _.filter(_.get(config, 'library.tags'), 'multi');
  return _.flatMap(fields, ({ name, id }) => {
    const rows = db
      .prepare(
        `SELECT t.value, COUNT(*) AS count FROM song_tags t JOIN check_scope s ON s.id = t.song_id
         WHERE t.frame_id = ? GROUP BY t.value`
      )
      .all(id);
    const groups = _.filter(
      _.groupBy(rows, ({ value }) => _.toLower(_.trim(value))),
      group => group.length > 1
    );
    return _.map(groups, group => ({
      file: null,
      detail: `${name}: ${_.map(_.orderBy(group, 'count', 'desc'), ({ value, count }) => `${value} (${count})`).join(' / ')}`
    }));
  });
};

/**
 * Ratings off the half step scale (2.8 instead of 3.0 or 2.5), decoded from the rating frame the way
 * the library reads it.
 */
const rating = ({ db, config }) => {
  const frame = _.get(config, 'rating.tag', 'POPM');
  const max = _.get(config, 'rating.max', 5);
  return _.compact(
    _.map(
      db
        .prepare(
          `SELECT songs.path, t.value FROM song_tags t
           JOIN check_scope s ON s.id = t.song_id JOIN songs ON songs.id = t.song_id
           WHERE t.frame_id = ? ORDER BY songs.path`
        )
        .all(frame),
      ({ path: file, value }) => {
        let raw;
        try {
          raw = JSON.parse(value).rating;
        } catch {
          return { file, detail: `${frame} cannot be read: ${value}` };
        }
        const stars = Number(((raw / 255) * max).toFixed(1));
        return Number.isInteger(stars * 2)
          ? null
          : { file, detail: `rating ${stars} (${frame} ${raw})` };
      }
    )
  );
};

// text that looks garbled by a wrong encoding: the replacement character, UTF-8 read as Latin-1
// (Ã©, â€™), control characters, or halfwidth/fullwidth forms in text without CJK characters
const garbledPatterns = [
  '\\uFFFD',
  '\\u00C3[\\u0080-\\u00BF]',
  '\\u00E2\\u20AC',
  '\\u00C2[\\u00A0-\\u00BF]',
  '[\\u0001-\\u0008\\u000B\\u000C\\u000E-\\u001F]'
].map(pattern => new RegExp(pattern));
const widthForms = new RegExp('[\\uFF01-\\uFFEF]');
const cjk = new RegExp('[\\u3040-\\u30FF\\u3400-\\u9FFF\\uAC00-\\uD7AF]');
const looksGarbled = value =>
  _.some(garbledPatterns, pattern => pattern.test(value)) ||
  (widthForms.test(value) && !cjk.test(value));

// text frames whose value looks garbled; structured frames (pictures, ratings) are left out
const encoding = ({ db }) =>
  _.compact(
    _.map(
      db
        .prepare(
          `SELECT songs.path, t.frame_id, t.value FROM song_tags t
           JOIN check_scope s ON s.id = t.song_id JOIN songs ON songs.id = t.song_id
           WHERE (t.frame_id LIKE 'T%' OR t.frame_id = 'COMM') ORDER BY songs.path`
        )
        .all(),
      ({ path: file, frame_id: frame, value }) =>
        looksGarbled(value) ? { file, detail: `${frame}: ${value}` } : null
    )
  );

// artist and title compared without case, punctuation, or spacing
const songKey = text =>
  _.toLower(text || '')
    .normalize('NFKD')
    .replace(new RegExp('[\\u0300-\\u036F]', 'g'), '')
    .replace(/[^a-z0-9]/g, '');

/**
 * The same song in more than one file: one Spotify track id, one MusicBrainz track id, or the same
 * artist and title with lengths within two seconds. One finding per group.
 */
const duplicates = ({ db, songs }) => {
  const byId = _.keyBy(songs, 'id');
  const groupFinding = (reason, ids) => ({
    file: null,
    detail: `${reason}: ${_.map(ids, id => byId[id].path).join('  |  ')}`,
    files: _.map(ids, id => byId[id].path)
  });
  const sameFrame = (frame, reason) =>
    _.map(
      _.pickBy(
        _.groupBy(
          db
            .prepare(
              `SELECT t.song_id, t.value FROM song_tags t JOIN check_scope s ON s.id = t.song_id
               WHERE t.frame_id = ?`
            )
            .all(frame),
          'value'
        ),
        group => _.uniqBy(group, 'song_id').length > 1
      ),
      (group, value) => groupFinding(`${reason} ${value}`, _.uniq(_.map(group, 'song_id')))
    );
  const spotify = sameFrame('TXXX.sp_track_id', 'Spotify track');
  const musicbrainz = _.map(
    _.pickBy(_.groupBy(_.filter(songs, 'mb_track_id'), 'mb_track_id'), group => group.length > 1),
    (group, value) => groupFinding(`MusicBrainz track ${value}`, _.map(group, 'id'))
  );
  // artist and title per song, then songs of one key grouped where their lengths are close
  const tags = db
    .prepare(
      `SELECT t.song_id, t.frame_id, t.value FROM song_tags t JOIN check_scope s ON s.id = t.song_id
       WHERE t.frame_id IN ('TPE1', 'TIT2')`
    )
    .all();
  const perSong = _.mapValues(_.groupBy(tags, 'song_id'), rows =>
    _.fromPairs(_.map(rows, ({ frame_id: frame, value }) => [frame, value]))
  );
  const keyed = _.groupBy(
    _.filter(_.keys(perSong), id => perSong[id].TPE1 && perSong[id].TIT2),
    id => `${songKey(perSong[id].TPE1)}\u0000${songKey(perSong[id].TIT2)}`
  );
  const named = _.flatMap(keyed, ids => {
    if (ids.length < 2) {
      return [];
    }
    const sorted = _.sortBy(_.map(ids, Number), id => byId[id].duration || 0);
    const clusters = [];
    _.each(sorted, id => {
      const last = _.last(clusters);
      const previous = last && byId[_.last(last)];
      if (
        previous &&
        Math.abs((byId[id].duration || 0) - (previous.duration || 0)) <= durationTolerance
      ) {
        last.push(id);
      } else {
        clusters.push([id]);
      }
    });
    return _.map(
      _.filter(clusters, cluster => cluster.length > 1),
      cluster =>
        groupFinding(`Same song ${perSong[cluster[0]].TPE1} - ${perSong[cluster[0]].TIT2}`, cluster)
    );
  });
  // a group found by an id is not listed again by name
  const seen = new Set(
    _.map([...spotify, ...musicbrainz], ({ files }) => _.sortBy(files).join('\n'))
  );
  return [
    ...spotify,
    ...musicbrainz,
    ..._.reject(named, ({ files }) => seen.has(_.sortBy(files).join('\n')))
  ];
};

module.exports = {
  caseVariants,
  duplicates,
  encoding,
  leftoverSpotifyFrame,
  looksGarbled,
  nameKey,
  names,
  rating,
  spotifyId,
  standard,
  withScope
};
