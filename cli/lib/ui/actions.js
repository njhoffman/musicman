const _ = require('lodash');
const path = require('path');

const { getMeta } = require('../db/database.js');
const { beginJournal, endJournal } = require('../history/journal.js');
const {
  acceptReview,
  rejectReview,
  rejectedCandidatesKey,
  reviewItems,
  songFields,
  spotifyIdFrame
} = require('../sync/match.js');
const { pathLayouts } = require('../beets/layout.js');
const { readBeetsConfig } = require('../spotify/beets.js');
const { finishRun, startRun } = require('../utils/runs.js');

/**
 * The review item acceptReview and rejectReview take for a song and a Spotify track: the review entry
 * when the song waits for review with that candidate, otherwise one built from the song, the stored
 * details of a rejected candidate or the file's TXXX.sp_* fields, and whether the file already has the
 * track's id (linked). Null when the song is not in the database.
 */
const reviewItem = (db, config, songId, trackId) => {
  const waiting = _.find(
    reviewItems(db, config),
    item => item.songId === songId && item.candidate.id === trackId
  );
  if (waiting) {
    return waiting;
  }
  const row = db.prepare('SELECT id, path, duration FROM songs WHERE id = ?').get(songId);
  if (!row) {
    return null;
  }
  const frame = frameId =>
    _.get(
      db
        .prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ? LIMIT 1')
        .get(songId, frameId),
      'value'
    );
  const linked = frame(spotifyIdFrame) === trackId;
  const stored = _.get(getMeta(db, rejectedCandidatesKey), trackId);
  const candidate = linked
    ? {
        id: trackId,
        name: frame('TXXX.sp_title') || null,
        artists: frame('TXXX.sp_artist') || null,
        album: frame('TXXX.sp_album') || null,
        durationMs: Number(frame('TXXX.sp_duration_ms')) || null
      }
    : { id: trackId, ...stored };
  return {
    songId,
    file: path.join(path.resolve(config.mpd.baseDirectory), row.path),
    path: row.path,
    duration: row.duration,
    song: songFields(db, row),
    candidate,
    linked
  };
};

/**
 * Accept and reject from the page, each archived as a ui run with its tag changes recorded for
 * musicman undo, like the same actions of sync --review. The journal records one run at a time, so the
 * actions run one after another. getClient() gives the Spotify client accepting fetches fields with.
 */
const reviewActions = ({ db, config, getClient }) => {
  let queue = Promise.resolve();
  const layouts = () => pathLayouts(_.get(readBeetsConfig(config.sync.beetsConfig), 'paths'));

  const recorded = (args, work) => {
    const next = queue.then(async () => {
      const run = startRun({ command: 'ui', args, config });
      beginJournal({ run, config, db });
      let result;
      let error;
      try {
        result = await work();
        return result;
      } catch (err) {
        error = err;
        throw err;
      } finally {
        endJournal();
        finishRun(run, {
          config,
          result,
          error,
          exitCode: error || _.get(result, 'failed.length') ? 1 : 0
        });
      }
    });
    queue = next.catch(_.noop);
    return next;
  };

  const itemFor = (songId, trackId) => {
    const item = reviewItem(db, config, songId, trackId);
    if (!item) {
      const err = new Error(`No song ${songId} in the library`);
      err.status = 404;
      throw err;
    }
    return item;
  };

  return {
    accept: (songId, trackId) => {
      const item = itemFor(songId, trackId);
      return recorded(['accept', item.path, trackId], () =>
        acceptReview({ db, config, client: getClient(), items: [item], layouts: layouts() })
      );
    },
    reject: (songId, trackId) => {
      const item = itemFor(songId, trackId);
      return recorded(['reject', item.path, trackId], () =>
        rejectReview({ db, config, items: [item] })
      );
    }
  };
};

module.exports = { reviewActions, reviewItem };
