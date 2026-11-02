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
const { applyUndo, findHistoryRun, listHistory, planUndo } = require('../history/undo.js');

/**
 * The review item acceptReview and rejectReview take for a song and a Spotify track: the review entry
 * when the song waits for review with that candidate, otherwise one built from the song, the stored
 * details of a rejected candidate, the details of a track found by a search from the page (known, by
 * id), or the file's TXXX.sp_* fields, and whether the file already has the track's id (linked). Null when the song is not in the database.
 */
const reviewItem = (db, config, songId, trackId, known = new Map()) => {
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
    : { id: trackId, ...stored, ...known.get(trackId) };
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

// how many tracks found by searches from the page are remembered for accepting one of them
const knownLimit = 1000;

/**
 * Accept and reject from the page, each archived as a ui run with its tag changes recorded for
 * musicman undo, like the same actions of sync --review. The journal records one run at a time, so the
 * actions run one after another. getClient() gives the Spotify client accepting fetches fields with.
 * remember(candidates) keeps the details of tracks a search from the page found, so accepting one is
 * scored against what the page showed; the details come from Spotify, never from the page.
 */
const reviewActions = ({ db, config, getClient }) => {
  let queue = Promise.resolve();
  const known = new Map();
  const remember = candidates => {
    candidates.forEach(candidate => {
      known.delete(candidate.id);
      known.set(candidate.id, candidate);
    });
    // a Map iterates oldest first
    [...known.keys()]
      .slice(0, Math.max(0, known.size - knownLimit))
      .forEach(id => known.delete(id));
  };
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
    const item = reviewItem(db, config, songId, trackId, known);
    if (!item) {
      const err = new Error(`No song ${songId} in the library`);
      err.status = 404;
      throw err;
    }
    return item;
  };

  // a ui run that can be undone: recorded, not undone yet, without Spotify changes
  const undoableRun = runId => {
    const run = _.find(listHistory(db), { id: runId });
    const fail = (status, message) => {
      const err = new Error(message);
      err.status = status;
      return err;
    };
    if (!run || run.command !== 'ui') {
      throw fail(404, `No run ${runId} of the page`);
    }
    if (run.undoneBy) {
      throw fail(409, `${runId} was already undone by ${run.undoneBy}`);
    }
    if (run.spotify > 0) {
      throw fail(409, `${runId} changed Spotify playlists, undo it with musicman undo`);
    }
    return run;
  };

  return {
    remember,
    // undoes a run of the page (force: also files and rows changed since), as musicman undo does
    undo: (runId, { force = false } = {}) => {
      undoableRun(runId);
      return recorded(['undo', runId], async () => {
        const run = undoableRun(runId);
        const plan = planUndo(db, findHistoryRun(listHistory(db), run.id), { force });
        const result = await applyUndo({ db, config, client: null, plan });
        return { ...result, failed: result.tags.failed };
      });
    },
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
