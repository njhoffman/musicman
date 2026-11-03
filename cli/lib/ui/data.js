const _ = require('lodash');
const path = require('path');

const { duplicateGroups, planDuplicates } = require('../check/duplicates.js');
const { runChecks, selectChecks } = require('../check/index.js');
const { getMeta } = require('../db/database.js');
const { listHistory, planUndo } = require('../history/undo.js');
const { matchSimilarity } = require('../spotify/match.js');
const {
  rejectedCandidatesKey,
  rememberRejected,
  reviewItems,
  songFields,
  spotifyIdFrame
} = require('../sync/match.js');

const frameValue = (db, songId, frameId) =>
  _.get(
    db
      .prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ? LIMIT 1')
      .get(songId, frameId),
    'value'
  );

// a song as the page shows it: id, path, artist, title, album, and duration in seconds
const songView = (db, row) => ({ id: row.id, path: row.path, ...songFields(db, row) });

// a Spotify track as the page shows it, from a candidate ({ id, name, artists, album, durationMs })
const trackView = candidate =>
  candidate
    ? {
        id: candidate.id,
        name: candidate.name || null,
        artists: candidate.artists || null,
        album: candidate.album || null,
        durationMs: candidate.durationMs || null
      }
    : null;

// similarity of a song and a candidate known by more than its id
const similarityOf = (song, candidate) =>
  candidate && candidate.name ? matchSimilarity(song, candidate) : null;

/**
 * Songs waiting for review: the local song, the Spotify candidate, their similarity, and whether the
 * file already has the candidate's id (linked).
 */
const reviewList = (db, config) =>
  _.map(reviewItems(db, config), item => ({
    song: { id: item.songId, path: item.path, ...item.song },
    track: trackView(item.candidate),
    similarity: item.similarity,
    linked: item.linked,
    source: item.source
  }));

/**
 * Songs whose match was accepted in review: the local song and the Spotify track it is linked to, from
 * the TXXX.sp_* fields of the file. Newest accepted first.
 */
const acceptedList = db =>
  _.map(
    db
      .prepare(
        `SELECT s.id, s.path, s.duration, m.track_id, m.source, m.reviewed_at FROM spotify_matches m
         JOIN songs s ON s.id = m.song_id
         WHERE m.status = 'match' AND m.reviewed_at IS NOT NULL ORDER BY m.reviewed_at DESC, s.path`
      )
      .all(),
    row => {
      const song = songView(db, row);
      const durationMs = Number(frameValue(db, row.id, 'TXXX.sp_duration_ms')) || null;
      const track = trackView({
        id: frameValue(db, row.id, spotifyIdFrame) || row.track_id,
        name: frameValue(db, row.id, 'TXXX.sp_title'),
        artists: frameValue(db, row.id, 'TXXX.sp_artist'),
        album: frameValue(db, row.id, 'TXXX.sp_album'),
        durationMs
      });
      return {
        song,
        track,
        similarity: similarityOf(song, track),
        source: row.source,
        reviewedAt: row.reviewed_at
      };
    }
  );

/**
 * Songs with tracks rejected in review: the local song, each rejected track (details from the stored
 * candidates, only the id when unknown), and the track the song is linked to now, if any.
 */
const rejectedList = db => {
  const known = getMeta(db, rejectedCandidatesKey) || {};
  return _.map(
    db
      .prepare(
        `SELECT s.id, s.path, s.duration, m.status, m.rejected FROM spotify_matches m
         JOIN songs s ON s.id = m.song_id WHERE m.rejected IS NOT NULL ORDER BY s.path`
      )
      .all(),
    row => {
      const song = songView(db, row);
      const currentId = frameValue(db, row.id, spotifyIdFrame) || null;
      return {
        song,
        status: row.status,
        current: currentId
          ? trackView({
              id: currentId,
              name: frameValue(db, row.id, 'TXXX.sp_title'),
              artists: frameValue(db, row.id, 'TXXX.sp_artist'),
              album: frameValue(db, row.id, 'TXXX.sp_album'),
              durationMs: Number(frameValue(db, row.id, 'TXXX.sp_duration_ms')) || null
            })
          : null,
        rejected: _.map(JSON.parse(row.rejected), id => {
          const track = trackView({ id, ...known[id] });
          return { track, similarity: similarityOf(song, track) };
        })
      };
    }
  );
};

/**
 * Songs sync --match looked up without finding a candidate (status missing), by path, with when they
 * were last looked up.
 */
const missingList = db =>
  _.map(
    db
      .prepare(
        `SELECT s.id, s.path, s.duration, m.checked_at FROM spotify_matches m
         JOIN songs s ON s.id = m.song_id WHERE m.status = 'missing' ORDER BY s.path`
      )
      .all(),
    row => ({ song: songView(db, row), checkedAt: row.checked_at })
  );

// how many runs of the page the history lists
const historyLimit = 100;

/**
 * The runs of the page (accept, reject, undo) with what undoing each would do, newest first: per file
 * the frames to restore and per song the Spotify match to put back, each with status restore, changed
 * (changed since; undo with force), or missing.
 */
const historyList = (db, config) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  return _.map(_.take(_.filter(listHistory(db), { command: 'ui' }), historyLimit), run => {
    const plan = planUndo(db, run, { baseDirectory });
    return {
      id: run.id,
      args: run.args,
      startedAt: run.startedAt,
      undoes: run.undoes,
      undoneBy: run.undoneBy,
      spotify: run.spotify,
      files: _.map(plan.files, ({ file, frames, status, changed }) => ({
        path: path.relative(baseDirectory, file),
        frames: _.map(frames, 'frame'),
        status,
        changed
      })),
      matches: _.map(plan.matches, ({ path: songPath, before, status }) => ({
        path: songPath,
        before: before ? before.status : null,
        status
      })),
      moves: _.map(plan.moves, ({ action, file, movedTo, status }) => ({
        action,
        path: path.relative(baseDirectory, action === 'restore' ? movedTo : file),
        status
      }))
    };
  });
};

// track ids of rejectedList entries known only by their id
const unknownRejected = list =>
  _.uniq(
    _.map(
      _.filter(_.flatMap(list, 'rejected'), ({ track }) => !track.name),
      'track.id'
    )
  );

// a candidate from a Web API track object
const candidateOfTrack = track => ({
  id: track.id,
  name: track.name,
  artists: _.map(track.artists, 'name').join(', '),
  album: _.get(track, 'album.name') || null,
  durationMs: track.duration_ms || null
});

/**
 * Fetches the Spotify details of rejected tracks known only by their id and stores them, so they are
 * fetched once. Returns how many were stored.
 */
const fetchRejected = async (db, client, ids) => {
  const found = [];
  for (const chunk of _.chunk(ids, 50)) {
    const response = await client.get(`/tracks?ids=${chunk.join(',')}`);
    found.push(..._.map(_.compact(response.tracks), candidateOfTrack));
  }
  rememberRejected(db, found);
  return found.length;
};

/**
 * What the last sync found to transfer, from the cached Spotify playlists (no Spotify requests):
 * toLocal, tracks in mapped playlists that are not in the library (sync --pull downloads them), one
 * entry per track with the playlists it is in; toSpotify, songs that belong in a playlist but have no
 * Spotify id (only local files can bring them to Spotify), with the playlists they belong in. plan is
 * syncPlan for the library songs; syncedAt is the newest cache refresh.
 */
const transferLists = (db, config, plan) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const toLocal = _.map(
    _.groupBy(
      _.flatMap(plan, target => _.map(target.pull, track => ({ ...track, playlist: target.name }))),
      'track_id'
    ),
    entries => ({
      track: {
        id: entries[0].track_id,
        name: entries[0].name,
        artists: entries[0].artists,
        album: entries[0].album
      },
      playlists: _.uniq(_.map(entries, 'playlist'))
    })
  );
  const toSpotify = _.map(
    _.groupBy(
      _.flatMap(plan, target => _.map(target.noId, song => ({ ...song, playlist: target.name }))),
      'file'
    ),
    entries => {
      const songPath = path.relative(baseDirectory, entries[0].file);
      const row = db.prepare('SELECT id, path, duration FROM songs WHERE path = ?').get(songPath);
      const match = row
        ? db.prepare('SELECT status FROM spotify_matches WHERE song_id = ?').get(row.id)
        : null;
      return {
        song: row ? songView(db, { ...row, path: songPath }) : { id: null, path: songPath },
        status: match ? match.status : null,
        playlists: _.uniq(_.map(entries, 'playlist'))
      };
    }
  );
  const synced = db.prepare('SELECT MAX(synced_at) AS at FROM spotify_playlists').get();
  return {
    syncedAt: synced ? synced.at : null,
    toLocal: _.sortBy(toLocal, ({ track }) => `${track.artists} ${track.name}`.toLowerCase()),
    toSpotify: _.sortBy(toSpotify, ({ song }) => song.path)
  };
};

/**
 * Markers that change when the lists would: review, from the Spotify matches (a sync --match, an
 * accept or reject anywhere); transfers, from the cached playlists, the library songs, and the matches;
 * history, from the recorded runs.
 * Cheap enough to poll; the page compares them with the markers of the lists it shows.
 */
const changeMarkers = db => {
  const matches = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(checked_at) AS checked, MAX(reviewed_at) AS reviewed,
         SUM(status = 'review') AS waiting, SUM(reviewed_at IS NOT NULL) AS accepted,
         SUM(LENGTH(rejected)) AS rejected, SUM(track_id IS NOT NULL) AS linked
       FROM spotify_matches`
    )
    .get();
  const songs = db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS updated FROM songs').get();
  const tagged = db.prepare('SELECT COUNT(*) AS n FROM song_tags').get();
  const history = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(started_at) AS started, SUM(undone_by IS NOT NULL) AS undone
       FROM history_runs`
    )
    .get();
  const playlists = db.prepare('SELECT MAX(synced_at) AS synced FROM spotify_playlists').get();
  const review = _.map(
    ['n', 'checked', 'reviewed', 'waiting', 'accepted', 'rejected', 'linked'],
    key => matches[key] ?? ''
  ).join('|');
  return {
    review,
    transfers: [review, songs.n, songs.updated ?? '', playlists.synced ?? ''].join('|'),
    // the songs and their Spotify ids decide the duplicate groups
    duplicates: [songs.n, songs.updated ?? '', tagged.n].join('|'),
    // a run of the page, or an undo or edit in a terminal, changes it; tag edits also change review
    history: [review, history.n, history.started ?? '', history.undone ?? 0].join('|')
  };
};

/**
 * The duplicate groups of the library with what check --fix would do (planDuplicates), each copy with
 * its song fields to show and play: [{ key, copies: [{ song, action, reason, size, rating, audio }],
 * keep, candidates, sameAudio }], audio the start of the copy's audio hash where it was read.
 * action is keep, trash (file to the trash), exclude (out of the library, file kept), clear (another
 * recording, matched again), or pick (no rule decides), else none.
 */
const duplicatesList = async (db, config) => {
  const [result] = await runChecks({
    db,
    config,
    target: config.mpd.baseDirectory,
    selected: selectChecks('duplicates'),
    listFiles: () => []
  });
  const select = db.prepare('SELECT id, path, duration FROM songs WHERE path = ?');
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  return _.map(planDuplicates(duplicateGroups(db, result.findings), { baseDirectory }), group => {
    const action = file => {
      if (group.keep === file) {
        return 'keep';
      }
      if (group.trash.includes(file)) {
        return 'trash';
      }
      if (group.exclude.includes(file)) {
        return 'exclude';
      }
      if (group.clear.includes(file)) {
        return 'clear';
      }
      return group.candidates.includes(file) ? 'pick' : 'none';
    };
    const picks = _.filter(group.files, item => group.candidates.includes(item.path));
    const sounds = _.map(picks, 'audio');
    return {
      key: _.map(group.files, 'path').sort().join('|'),
      keep: group.keep,
      candidates: group.candidates,
      // whether the copies to pick from have the same audio (null when there is nothing to pick)
      sameAudio: picks.length > 0 ? Boolean(sounds[0]) && _.uniq(sounds).length === 1 : null,
      copies: _.map(group.files, item => ({
        song: songView(db, select.get(item.path)),
        action: action(item.path),
        reason: group.reasons[item.path] || null,
        size: item.size,
        rating: item.rating,
        audio: item.audio ? item.audio.slice(0, 8) : null
      }))
    };
  });
};

module.exports = {
  acceptedList,
  duplicatesList,
  candidateOfTrack,
  changeMarkers,
  fetchRejected,
  historyList,
  missingList,
  rejectedList,
  reviewList,
  transferLists,
  unknownRejected
};
