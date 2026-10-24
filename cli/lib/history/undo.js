const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');

const { transaction } = require('../db/database.js');
const { updateDatabase } = require('../db/update.js');
const { rewriteTags } = require('../metadata/write.js');
const { refreshCache } = require('../sync/cache.js');
const { likedBatch, playlistBatch, playlistRequest, uri } = require('../sync/push.js');
const { saveSnapshot } = require('../sync/snapshot.js');
const { likedId } = require('../sync/targets.js');
const { frameMap, hashValue, parseValue, recordSpotify, recordUndo } = require('./journal.js');

/**
 * Runs with recorded changes, newest first: { id, command, args, startedAt, files, frames, spotify,
 * undoes, undoneBy }.
 */
const listHistory = db =>
  _.map(
    db
      .prepare(
        `SELECT r.*,
           (SELECT count(DISTINCT path) FROM tag_changes WHERE run_id = r.id) AS files,
           (SELECT count(*) FROM tag_changes WHERE run_id = r.id) AS frames,
           (SELECT count(*) FROM spotify_changes WHERE run_id = r.id) AS spotify
         FROM history_runs r ORDER BY r.started_at DESC, r.id DESC`
      )
      .all(),
    row => ({
      id: row.id,
      command: row.command,
      args: JSON.parse(row.args || '[]'),
      startedAt: row.started_at,
      files: row.files,
      frames: row.frames,
      spotify: row.spotify,
      snapshot: row.spotify_snapshot,
      undoes: row.undoes,
      undoneBy: row.undone_by
    })
  );

// the run a term names: latest, a full id, or the newest run whose id starts with it
const findHistoryRun = (runs, term) =>
  term === 'latest'
    ? runs[0]
    : _.find(runs, { id: term }) || _.find(runs, ({ id }) => id.startsWith(term));

/**
 * What undoing a run would do. files: per file the frames to restore (each frame's value before the
 * run, its first change, and the hash of its value after the run, its last change) with status restore,
 * changed (a frame differs from what the run left, listed in changed), or missing (the file is gone,
 * e.g. moved by beets). force restores changed files too. spotify: the run's Spotify changes newest
 * first, each to be reversed.
 */
const planUndo = (db, run, { force = false } = {}) => {
  const rows = db
    .prepare('SELECT path, frame, before, after_hash FROM tag_changes WHERE run_id = ? ORDER BY id')
    .all(run.id);
  const files = _.map(_.groupBy(rows, 'path'), (fileRows, file) => {
    const frames = _.map(_.groupBy(fileRows, 'frame'), frameRows => ({
      frame: frameRows[0].frame,
      before: _.first(frameRows).before,
      afterHash: _.last(frameRows).after_hash
    }));
    if (!fs.existsSync(file)) {
      return { file, frames, status: 'missing', changed: [] };
    }
    const current = frameMap(file);
    const changed = _.map(
      _.filter(frames, ({ frame, afterHash }) => hashValue(current[frame]) !== afterHash),
      'frame'
    );
    return { file, frames, status: changed.length > 0 && !force ? 'changed' : 'restore', changed };
  });
  const spotify = db
    .prepare(
      `SELECT target_id, target_name, action, track_id FROM spotify_changes WHERE run_id = ?
       ORDER BY id DESC`
    )
    .all(run.id)
    .map(row => ({
      targetId: row.target_id,
      targetName: row.target_name,
      action: row.action,
      trackId: row.track_id
    }));
  return { run, files, spotify };
};

// raw node-id3 frames with the recorded frames set back to their values before (absent when null)
const restoreFrames = (raw, frames) => {
  frames.forEach(({ frame, before }) => {
    const value = before === null ? undefined : parseValue(before);
    if (frame.startsWith('TXXX.')) {
      const description = frame.slice(5);
      const others = _.reject([].concat(raw.TXXX || []), { description });
      const txxx = value === undefined ? others : others.concat(value);
      if (txxx.length > 0) {
        raw.TXXX = txxx;
      } else {
        delete raw.TXXX;
      }
    } else if (value === undefined) {
      delete raw[frame];
    } else {
      raw[frame] = value;
    }
  });
  return raw;
};

/**
 * Restores the files of a plan with status restore and updates the database for those inside
 * mpd.baseDirectory. Returns { restored, failed } files.
 */
const undoTags = async ({ db, config, plan }) => {
  const restored = [];
  const failed = [];
  _.filter(plan.files, { status: 'restore' }).forEach(item => {
    const result = rewriteTags(item.file, raw => restoreFrames(raw, item.frames));
    if (result instanceof Error) {
      failed.push({ ...item, error: result.message });
    } else {
      restored.push(item);
    }
  });
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const inLibrary = _.filter(_.map(restored, 'file'), file => {
    const relative = path.relative(baseDirectory, file);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (inLibrary.length > 0) {
    await updateDatabase(db, { config, files: inLibrary, record: false });
  }
  return { restored, failed };
};

// track ids of each target in a saved snapshot, in playlist order
const snapshotTracks = file => {
  if (!file || !fs.existsSync(file)) {
    return null;
  }
  const { targets } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return _.fromPairs(_.map(targets, ({ id, tracks }) => [id, _.map(tracks, 'track_id')]));
};

/**
 * Reverses a plan's Spotify changes: tracks the run added are removed, tracks it removed are added back,
 * at their old playlist position when the snapshot saved before the run has it (Liked Songs get a new
 * added date). Spotify is saved as it is first (saveSnapshot); tracks already as they were before the
 * run are left alone. spotify_synced is updated so the next sync sees the undo as a local change, not
 * one made on Spotify. Returns { removed, added, skipped, snapshot } with { targetName, trackId } items.
 */
const undoSpotify = async ({ db, config, client, plan }) => {
  const result = { removed: [], added: [], skipped: [], snapshot: null };
  if (plan.spotify.length === 0) {
    return result;
  }
  const saved = await saveSnapshot(client, config);
  result.snapshot = saved.file;
  const current = snapshotTracks(saved.file);
  const before = snapshotTracks(plan.run.snapshot) || {};
  const syncedDelete = db.prepare(
    'DELETE FROM spotify_synced WHERE playlist_id = ? AND track_id = ?'
  );
  const syncedInsert = db.prepare(
    'INSERT OR IGNORE INTO spotify_synced (playlist_id, track_id) VALUES (?, ?)'
  );

  const byTarget = _.groupBy(plan.spotify, 'targetId');
  await Promise.each(_.keys(byTarget), async targetId => {
    const changes = byTarget[targetId];
    const target = { id: targetId, name: changes[0].targetName };
    const present = new Set(current[targetId] || []);
    // the latest change of each track decides what undoing it means
    const latest = _.uniqBy(changes, 'trackId');
    const [toRemove, toAdd] = _.partition(latest, { action: 'add' });
    const removeIds = _.map(
      _.filter(toRemove, ({ trackId }) => present.has(trackId)),
      'trackId'
    );
    const addIds = _.map(
      _.filter(toAdd, ({ trackId }) => !present.has(trackId)),
      'trackId'
    );
    result.skipped.push(
      ..._.map(_.difference(_.map(latest, 'trackId'), [...removeIds, ...addIds]), trackId => ({
        targetName: target.name,
        trackId
      }))
    );

    if (targetId === likedId) {
      await Promise.each(_.chunk(removeIds, likedBatch), async ids => {
        await client.request('DELETE', '/me/tracks', { ids });
        recordSpotify({ target, action: 'remove', trackIds: ids });
      });
      await Promise.each(_.chunk(addIds, likedBatch), async ids => {
        await client.request('PUT', '/me/tracks', { ids });
        recordSpotify({ target, action: 'add', trackIds: ids });
      });
    } else {
      await Promise.each(_.chunk(removeIds, playlistBatch), async ids => {
        await playlistRequest(client, 'DELETE', targetId, ids.map(uri));
        recordSpotify({ target, action: 'remove', trackIds: ids });
      });
      // in their old order, so each earlier position is already filled when a later one is added
      const order = before[targetId] || [];
      const positioned = _.sortBy(addIds, trackId => {
        const index = order.indexOf(trackId);
        return index === -1 ? Infinity : index;
      });
      await Promise.each(positioned, async trackId => {
        const index = order.indexOf(trackId);
        await playlistRequest(client, 'POST', targetId, [uri(trackId)], {
          position: index === -1 ? null : index
        });
        recordSpotify({ target, action: 'add', trackIds: [trackId] });
      });
    }
    transaction(db, () => {
      removeIds.forEach(trackId => syncedDelete.run(targetId, trackId));
      addIds.forEach(trackId => syncedInsert.run(targetId, trackId));
    });
    result.removed.push(..._.map(removeIds, trackId => ({ targetName: target.name, trackId })));
    result.added.push(..._.map(addIds, trackId => ({ targetName: target.name, trackId })));
  });
  await refreshCache(db, client, _.without(_.keys(byTarget), likedId));
  return result;
};

/**
 * Undoes a run (from planUndo): restores its tag changes, reverses its Spotify changes when a client
 * is given, and marks it undone by the active run. Returns { tags, spotify }.
 */
const applyUndo = async ({ db, config, client, plan }) => {
  const tags = await undoTags({ db, config, plan });
  const spotify = client
    ? await undoSpotify({ db, config, client, plan })
    : { removed: [], added: [], skipped: [], snapshot: null };
  recordUndo(plan.run.id);
  return { tags, spotify };
};

module.exports = {
  applyUndo,
  findHistoryRun,
  listHistory,
  planUndo,
  restoreFrames,
  undoSpotify,
  undoTags
};
