const _ = require('lodash');
const path = require('path');

const { libraryFileForPlaying, trackForLibraryFile } = require('../player/library.js');
const { itemFields, toRow } = require('../sync/cache.js');
const { confirmedFiles, isLocalTrackOf } = require('../sync/localFiles.js');
const { cachedIn } = require('../sync/song.js');
const { likedId } = require('../sync/targets.js');
const logger = require('../utils/logger.js');

// how long an answer from Spotify serves every asker (the bar and the notification ask about one track)
const answerMs = 10000;

// whether Spotify has a track in Liked Songs now; null when its answer is not usable
const likedOnSpotify = client => async trackId => {
  const [liked] = await client().get(`/me/tracks/contains?ids=${encodeURIComponent(trackId)}`);
  return _.isBoolean(liked) ? liked : null;
};

/**
 * liked(trackId) shared by its askers: a question already on its way, or answered within the last ttl
 * ms, gets that answer instead of another request. A failed or unusable answer is not kept.
 */
const sharedAnswers = (liked, { ttl = answerMs, now = Date.now } = {}) => {
  const answers = new Map();
  return trackId => {
    const known = answers.get(trackId);
    if (known && (known.pending || now() - known.at < ttl)) {
      return known.answer;
    }
    const entry = { pending: true, at: 0 };
    entry.answer = Promise.resolve()
      .then(() => liked(trackId))
      .then(
        answer => {
          entry.pending = false;
          entry.at = now();
          if (!_.isBoolean(answer)) {
            answers.delete(trackId);
          }
          return answer;
        },
        err => {
          answers.delete(trackId);
          throw err;
        }
      );
    // only the latest track's answers are worth keeping
    answers.clear();
    answers.set(trackId, entry);
    return entry.answer;
  };
};

/**
 * The local files in Liked Songs, which /me/tracks never lists, from the playlist the player reports as
 * its context while playing Liked Songs (sync.likedPlaylistId; undocumented, so it may go away).
 * refresh() fetches them only when the playlist's snapshot changed, resolving to whether it did. has(tags)
 * is whether a track ({ artist, title, duration }) is among them, or null while they are unknown. A
 * playlist Spotify refuses forgets the list; other failures (offline) keep the last one.
 */
const localLikes = (client, playlistId) => {
  const playlist = `/playlists/${encodeURIComponent(playlistId)}`;
  let snapshot = null;
  let rows = null;
  let warned = false;
  return {
    refresh: async () => {
      try {
        const { snapshot_id: current } = await client().get(`${playlist}?fields=snapshot_id`);
        if (rows && current === snapshot) {
          return false;
        }
        const items = await client().paginate(
          `${playlist}/items?limit=100&fields=${encodeURIComponent(itemFields)}`
        );
        rows = _.filter(_.map(items, toRow), 'is_local');
        snapshot = current;
        warned = false;
        return true;
      } catch (err) {
        if (!warned) {
          logger.warn(`Could not read sync.likedPlaylistId: ${err.message}`);
        }
        warned = true;
        if ([403, 404].includes(err.status) && rows) {
          rows = null;
          snapshot = null;
          return true;
        }
        return false;
      }
    },
    has: tags => (rows ? _.some(rows, row => isLocalTrackOf(tags, row)) : null)
  };
};

// whether a library file (absolute path) was confirmed in Liked Songs by sync --export --confirm
const confirmedLikedFile = config => file =>
  confirmedFiles(config)(likedId).has(path.resolve(file));

/**
 * What decides a track's heart, from the library database (null without one): its library file, its
 * Spotify id (its own, or the one tagged on the file), whether the cached Liked Songs holds that id, the
 * file's sync --export --confirm, and for a track without its own id the tags local likes go by.
 */
const likeFacts = (
  db,
  config,
  { player, track },
  { confirmedLiked = confirmedLikedFile(config) }
) => {
  let file = player.source === 'mpd' ? track.file || null : null;
  let trackId = track.trackId || null;
  let cached = false;
  if (db) {
    file = libraryFileForPlaying(db, config, player, track);
    trackId = trackId || (file ? trackForLibraryFile(db, config, file) : null);
    cached = trackId ? cachedIn(db, likedId, trackId) : false;
  }
  return {
    file,
    trackId,
    catalogLiked: cached,
    confirmed: file ? confirmedLiked(file) : false,
    tags: track.trackId
      ? null
      : { artist: track.artist, title: track.title, duration: track.duration }
  };
};

/**
 * The heart: Spotify's answer (or the cached Liked Songs) for the track's id; for a track without its own
 * id also the local likes (likes, optional), or while those are unknown its file's confirmation.
 */
const isHearted = (facts, likes = null) => {
  if (facts.catalogLiked) {
    return true;
  }
  if (!facts.tags) {
    return false;
  }
  const known = likes ? likes.has(facts.tags) : null;
  return known === null ? Boolean(facts.confirmed) : known;
};

module.exports = {
  answerMs,
  confirmedLikedFile,
  isHearted,
  likeFacts,
  likedOnSpotify,
  localLikes,
  sharedAnswers
};
