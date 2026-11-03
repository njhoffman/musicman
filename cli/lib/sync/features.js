const _ = require('lodash');

const { trackIdName } = require('../spotify/fields.js');

/**
 * Audio features from ReccoBeats (api.reccobeats.com), looked up by Spotify track id: Spotify's own
 * /audio-features answers 403 to apps made after 2024-11-27. The values are ReccoBeats' estimates, not
 * Spotify's, so the custom frames are named rb_<field>; tempo goes to TBPM and key with mode to TKEY,
 * the standard frames beets (bpm) and DJ software read.
 */
const reccoBeatsUrl = 'https://api.reccobeats.com/v1';

// the fields that can be fetched (features.fields picks among them); key brings its mode along
const featureFields = [
  'acousticness',
  'danceability',
  'energy',
  'instrumentalness',
  'key',
  'liveness',
  'loudness',
  'speechiness',
  'tempo',
  'valence'
];

// the custom frame of a field, and the one marking when a song's features were fetched
const featurePrefix = 'rb_';
const fetchedName = `${featurePrefix}fetched_at`;
const featureName = field => `${featurePrefix}${field}`;

// ids per request, and the pause between requests
const batchSize = 40;
const pauseMs = 500;

const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// a key in standard notation: C#, or C#m for a minor mode; null when not detected (-1)
const keyName = (key, mode) =>
  Number.isInteger(key) && key >= 0 && key < 12
    ? `${pitchClasses[key]}${mode === 0 ? 'm' : ''}`
    : null;

const trackIdOfHref = href => {
  const match = /open\.spotify\.com\/track\/([A-Za-z0-9]{22})/.exec(href || '');
  return match ? match[1] : null;
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The audio features of Spotify track ids, as a Map of track id to the ReccoBeats item (tracks it does
 * not know are left out). onBatch(done, total) after each request.
 */
const fetchFeatures = async (
  ids,
  { fetchImpl = fetch, baseUrl = reccoBeatsUrl, pause = pauseMs, onBatch = _.noop } = {}
) => {
  const found = new Map();
  const batches = _.chunk(_.uniq(ids), batchSize);
  for (const [i, batch] of batches.entries()) {
    if (i > 0 && pause > 0) {
      await wait(pause);
    }
    const res = await fetchImpl(`${baseUrl}/audio-features?ids=${batch.join(',')}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      throw new Error(`ReccoBeats audio-features failed (${res.status})`);
    }
    const body = await res.json();
    _.each(body.content || [], item => {
      const id = trackIdOfHref(item.href);
      if (id) {
        found.set(id, item);
      }
    });
    onBatch(Math.min((i + 1) * batchSize, ids.length), ids.length);
  }
  return found;
};

const decimals = (value, places) => (_.isNumber(value) ? value.toFixed(places) : null);

/**
 * The tag writes for a song's features, of the fields asked for: { custom: [{ name, value }],
 * standard: { TBPM, TKEY } }, with rb_fetched_at stamped at now.
 */
const featureWrites = (item, fields = featureFields, now = new Date()) => {
  const custom = [];
  const standard = {};
  _.each(fields, field => {
    if (field === 'tempo') {
      if (_.isNumber(item.tempo) && item.tempo > 0) {
        standard.TBPM = `${Math.round(item.tempo)}`;
      }
    } else if (field === 'key') {
      const key = keyName(item.key, item.mode);
      if (key) {
        standard.TKEY = key;
      }
    } else {
      const value = decimals(item[field], 2);
      if (value !== null) {
        custom.push({ name: featureName(field), value });
      }
    }
  });
  custom.push({ name: fetchedName, value: now.toISOString().slice(0, 10) });
  return { custom, standard };
};

/**
 * Library songs to fetch features for: those with a Spotify track id and, unless refresh, without
 * rb_fetched_at, and whose id ReccoBeats did not miss before (skipped, ids in missing). Returns
 * [{ path, trackId }], paths relative to mpd.baseDirectory.
 */
const songsForFeatures = (db, { refresh = false, missing = new Set() } = {}) =>
  _.reject(
    db
      .prepare(
        `SELECT s.path, t.value AS trackId FROM songs s
         JOIN song_tags t ON t.song_id = s.id AND t.frame_id = ?
         WHERE ? OR NOT EXISTS (
           SELECT 1 FROM song_tags f WHERE f.song_id = s.id AND f.frame_id = ?
         )
         ORDER BY s.path`
      )
      .all(`TXXX.${trackIdName}`, refresh ? 1 : 0, `TXXX.${fetchedName}`),
    ({ trackId }) => !refresh && missing.has(trackId)
  );

module.exports = {
  featureFields,
  featureName,
  featureWrites,
  fetchFeatures,
  fetchedName,
  keyName,
  reccoBeatsUrl,
  songsForFeatures,
  trackIdOfHref
};
