const _ = require('lodash');
const crypto = require('crypto');
const NodeId3 = require('node-id3');

const { openDatabase } = require('../db/database.js');
const logger = require('../utils/logger.js');
const {
  fieldChanges,
  libraryPath,
  matchDecision,
  recordChanges,
  songIdentity
} = require('./changes.js');

// runs whose changes are kept for undo, older ones are removed when a run finishes
const defaultKeep = 50;

// the run being recorded: { id, command, args, startedAt, db, ownDb, created }
let active = null;

// JSON that keeps Buffers (UFID identifiers, APIC images) as base64, revived by parseValue
const serialize = value =>
  JSON.stringify(value, (key, item) =>
    item && item.type === 'Buffer' && _.isArray(item.data)
      ? { $buffer: Buffer.from(item.data).toString('base64') }
      : item
  );

const parseValue = text =>
  JSON.parse(text, (key, item) =>
    item && _.isString(item.$buffer) ? Buffer.from(item.$buffer, 'base64') : item
  );

const hashValue = value =>
  value === undefined ? null : crypto.createHash('sha1').update(serialize(value)).digest('hex');

// a file's raw node-id3 tags, {} when unreadable
const readRaw = file => {
  try {
    return _.get(NodeId3.read(file), 'raw', {}) || {};
  } catch {
    return {};
  }
};

/**
 * Raw tags keyed the way changes are recorded: one key per frame id, and one per TXXX description
 * (TXXX.sp_track_id), since each description is a field of its own.
 */
const framesOf = raw => {
  const frames = {};
  _.each(raw, (value, id) => {
    if (id === 'TXXX') {
      _.each(_.groupBy([].concat(value), 'description'), (items, description) => {
        frames[`TXXX.${description}`] = items;
      });
    } else {
      frames[id] = value;
    }
  });
  return frames;
};

// a file's frames as framesOf keys them, {} when unreadable
const frameMap = file => framesOf(readRaw(file));

// frames whose value differs between two frame maps
const changedFrames = (before, after) =>
  _.filter(
    _.union(_.keys(before), _.keys(after)),
    frame => !_.isEqual(serialize(before[frame]), serialize(after[frame]))
  );

/**
 * Starts recording what a run changes (run is the archived run of startRun). The library database is
 * opened on the first change, so runs that change nothing open nothing; db replaces it in tests.
 */
const beginJournal = ({ run, config, db }) => {
  active = {
    id: run.id,
    command: run.command,
    args: run.args,
    startedAt: run.startedAt,
    dbPath: _.get(config, 'db.path'),
    backupDirectory: _.get(config, 'db.backupDirectory'),
    db: db || null,
    ownDb: !db,
    created: false,
    keep: _.get(config, 'history.keep', defaultKeep),
    // the change log needs the library fields; a journal without them (some tests) records no changes
    config: _.get(config, 'library.tags') ? config : null
  };
  return active;
};

// the database of the active run, with its history_runs row created on first use
const journalDb = () => {
  if (!active.db) {
    active.db = openDatabase(active.dbPath, { backupDirectory: active.backupDirectory });
  }
  if (!active.created) {
    active.db
      .prepare(
        `INSERT OR IGNORE INTO history_runs (id, command, args, started_at) VALUES (?, ?, ?, ?)`
      )
      .run(
        active.id,
        active.command,
        JSON.stringify(active.args || []),
        active.startedAt.toISOString()
      );
    active.created = true;
  }
  return active.db;
};

// a failure to record never fails the change itself, it is logged instead
const safely = (what, fn) => {
  try {
    return fn();
  } catch (err) {
    logger.warn(`Could not record ${what} for undo: ${err.message}`);
    logger.logToFile('error', err.stack);
    return null;
  }
};

/**
 * Runs write (a tag write of file) and records the frames it changed for the active run: each frame's
 * value before, and a hash of its value after, so undo can tell whether the file changed since. Returns
 * what write returned. Without an active run it only writes.
 */
const journaledWrite = (file, write) => {
  if (!active) {
    return write();
  }
  const beforeRaw = readRaw(file);
  const before = framesOf(beforeRaw);
  const result = write();
  const afterRaw = readRaw(file);
  // also after a write that failed part way, whatever did change is recorded
  safely(`tag changes of ${file}`, () => {
    const after = framesOf(afterRaw);
    const frames = changedFrames(before, after);
    if (frames.length === 0) {
      return;
    }
    const db = journalDb();
    const insert = db.prepare(
      'INSERT INTO tag_changes (run_id, path, frame, before, after_hash) VALUES (?, ?, ?, ?, ?)'
    );
    frames.forEach(frame =>
      insert.run(
        active.id,
        file,
        frame,
        before[frame] === undefined ? null : serialize(before[frame]),
        hashValue(after[frame])
      )
    );
  });
  // the change log, by library field (lib/history/changes.js)
  if (active.config) {
    safely(`the change log of ${file}`, () => {
      const entries = fieldChanges(beforeRaw, afterRaw, active.config);
      if (entries.length > 0) {
        const db = journalDb();
        recordChanges(db, {
          config: active.config,
          song: songIdentity(db, { relativePath: libraryPath(active.config, file) }),
          entries,
          runId: active.id
        });
      }
    });
  }
  return result;
};

/**
 * Records Spotify tracks added to or removed from a target (Liked Songs or a playlist) by the active run;
 * action is add or remove. Called after each request that succeeded.
 */
const recordSpotify = ({ target, action, trackIds }) => {
  if (!active || trackIds.length === 0) {
    return;
  }
  safely(`Spotify changes of ${target.name || target.id}`, () => {
    const db = journalDb();
    const insert = db.prepare(
      `INSERT INTO spotify_changes (run_id, target_id, target_name, action, track_id)
       VALUES (?, ?, ?, ?, ?)`
    );
    trackIds.forEach(trackId => insert.run(active.id, target.id, target.name, action, trackId));
  });
};

/**
 * Records a file the active run moved (action trash: a duplicate moved to the trash) from file to to,
 * and whether it was taken out of beets (beets), so undo can move it back and import it again.
 */
const recordFileMove = ({ action, file, to, beets = false }) => {
  if (!active) {
    return;
  }
  safely(`the move of ${file}`, () =>
    journalDb()
      .prepare(
        'INSERT INTO file_changes (run_id, action, path, moved_to, beets) VALUES (?, ?, ?, ?, ?)'
      )
      .run(active.id, action, file, to, beets ? 1 : 0)
  );
};

// a song's spotify_matches row as a plain object, null when the song has none
const matchRow = (db, songId) => {
  const row = db
    .prepare(
      `SELECT status, track_id, source, candidate, checked_at, reviewed_at, rejected
       FROM spotify_matches WHERE song_id = ?`
    )
    .get(songId);
  return row ? { ...row } : null;
};

/**
 * Runs change (changes of a song's spotify_matches row in db, e.g. accepting in review) and records
 * the row before and a hash of the row after for the active run, so undo can put the row back. Returns
 * what change returned. Without an active run it only changes.
 */
const journaledMatch = (db, songId, change) => {
  if (!active) {
    return change();
  }
  const before = matchRow(db, songId);
  const result = change();
  safely(`the Spotify match of song ${songId}`, () => {
    const after = matchRow(db, songId);
    if (serialize(before) === serialize(after)) {
      return;
    }
    const song = db.prepare('SELECT path FROM songs WHERE id = ?').get(songId);
    journalDb()
      .prepare(
        'INSERT INTO match_changes (run_id, song_id, path, before, after_hash) VALUES (?, ?, ?, ?, ?)'
      )
      .run(active.id, songId, song ? song.path : null, serialize(before), hashValue(after));
    if (active.config && matchDecision(before) !== matchDecision(after)) {
      recordChanges(journalDb(), {
        config: active.config,
        song: songIdentity(db, { songId }),
        entries: [{ kind: 'match', value: matchDecision(after), previous: matchDecision(before) }],
        runId: active.id
      });
    }
  });
  return result;
};

// the snapshot of Spotify saved before the active run changed it, where undo finds track positions
const recordSpotifySnapshot = file => {
  if (!active) {
    return;
  }
  safely('the Spotify snapshot', () =>
    journalDb()
      .prepare('UPDATE history_runs SET spotify_snapshot = ? WHERE id = ?')
      .run(file, active.id)
  );
};

// marks the active run as the undo of another run
const recordUndo = undoneId => {
  if (!active) {
    return;
  }
  safely('the undo', () => {
    const db = journalDb();
    db.prepare('UPDATE history_runs SET undoes = ? WHERE id = ?').run(undoneId, active.id);
    db.prepare('UPDATE history_runs SET undone_by = ? WHERE id = ?').run(active.id, undoneId);
  });
};

// removes the runs beyond the newest keep, with their changes
const pruneHistory = (db, keep = defaultKeep) =>
  db
    .prepare(
      `DELETE FROM history_runs WHERE id NOT IN
         (SELECT id FROM history_runs ORDER BY started_at DESC, id DESC LIMIT ?)`
    )
    .run(keep).changes;

// stops recording: prunes old runs and closes the database the journal opened
const endJournal = () => {
  if (!active) {
    return;
  }
  const { db, ownDb, created, keep } = active;
  if (db && created) {
    safely('the history pruning', () => pruneHistory(db, keep));
  }
  if (db && ownDb) {
    db.close();
  }
  active = null;
};

const activeRun = () => (active ? active.id : null);

module.exports = {
  activeRun,
  beginJournal,
  changedFrames,
  endJournal,
  frameMap,
  hashValue,
  journaledMatch,
  journaledWrite,
  matchRow,
  parseValue,
  pruneHistory,
  recordFileMove,
  recordSpotify,
  recordSpotifySnapshot,
  recordUndo,
  serialize
};
