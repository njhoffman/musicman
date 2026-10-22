const _ = require('lodash');
const path = require('path');
const Promise = require('bluebird');
const globalTags = require('musicman-common/config/tags.json');

const { bestCandidate, looseQuery, sameTitle, searchQuery } = require('../spotify/match.js');
const { assignFields, fetchDetails, fetchedAtName, trackIdName } = require('../spotify/fields.js');
const { transaction } = require('../db/database.js');
const { updateDatabase } = require('../db/update.js');
const { rewriteTags, updateTags } = require('../metadata/write.js');
const logger = require('../utils/logger.js');

const spotifyIdFrame = `TXXX.${trackIdName}`;
const fetchedAtFrame = `TXXX.${fetchedAtName}`;

// days before review and missing results are looked up again
const defaultRecheckDays = 30;

// songs looked up and given their Spotify fields together, one batch of track requests each
const chunkSize = 50;

const daysAgo = (now, days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const frameValue = (db, songId, frameId) =>
  _.get(
    db
      .prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ? LIMIT 1')
      .get(songId, frameId),
    'value'
  );

const searchTracks = async (client, query, limit) =>
  _.get(
    await client.get(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`),
    'tracks.items',
    []
  );

// look up one song: beets id, then ISRC, then artist and title search, never a track rejected in review
const lookup = async ({ client, song, beetsId, rejected = new Set() }) => {
  if (beetsId && !rejected.has(beetsId)) {
    return { status: 'match', source: 'beets', candidate: { id: beetsId } };
  }
  const search = async (query, limit) =>
    _.reject(await searchTracks(client, query, limit), ({ id }) => rejected.has(id));
  if (song.isrc) {
    const result = bestCandidate(song, await search(`isrc:${song.isrc}`, 5), {
      isrc: true
    });
    if (result.status !== 'missing') {
      return { ...result, source: 'isrc' };
    }
  }
  const strict = bestCandidate(song, await search(searchQuery(song), 10));
  if (strict.status === 'match') {
    return { ...strict, source: 'search' };
  }
  // the looser query only replaces a strict result it improves on
  const loose = bestCandidate(song, await search(looseQuery(song), 10));
  const rank = { match: 0, review: 1, missing: 2 };
  return { ...(rank[loose.status] < rank[strict.status] ? loose : strict), source: 'search' };
};

// frame id of a tag name, user tags first like library.tags
const tagFrame = (config, name) =>
  _.get(_.find(config.tags || [], { name }) || _.find(globalTags, { name }), 'id');

/**
 * Splits assigned fields into what is written: every custom field, and fallbacks only for standard
 * tags the song has no value for (the others are kept, never overwritten).
 */
const plannedWrites = (db, config, songId, assignment) => {
  const fallbacks = _.map(assignment.fallbacks, fallback => {
    const frame = tagFrame(config, fallback.name);
    const existing = frameValue(db, songId, frame);
    return { ...fallback, frame, filled: !existing };
  });
  return {
    custom: assignment.custom,
    filled: _.filter(fallbacks, 'filled'),
    kept: _.reject(fallbacks, 'filled')
  };
};

const writeFields = (file, { custom, filled }) =>
  updateTags(
    {
      userDefinedText: _.map(custom, ({ name, value }) => ({ description: name, value })),
      ..._.fromPairs(_.map(filled, ({ frame, value }) => [frame, value]))
    },
    file
  );

// writes a song's fields, returning why it failed instead of stopping the run (null when written)
const tryWrite = (file, writes) => {
  try {
    const result = writeFields(file, writes);
    return result instanceof Error ? result.message : null;
  } catch (err) {
    logger.logToFile('error', `writing ${file}: ${err.stack}`);
    return `could not write tags: ${err.message}`;
  }
};

/**
 * Finds Spotify track ids for songs (from songTargets) that belong in a Spotify target and do not have
 * one yet, and writes the spotify.fields of matched songs. Confident matches get TXXX.sp_track_id and
 * their fields; probable matches are kept for review; misses are remembered for recheckDays. Songs
 * that already have an id get their fields again when they were never fetched, are older than
 * refreshDays, or refresh is set. Lookup results are cached in spotify_matches, also in a dry run, so a
 * cached match is not searched for again; dryRun writes nothing else (no files, no song tags). Results
 * are saved after every chunk of songs, so an interrupted run keeps what it did.
 *
 * onSong(status, item, result) is called once per looked up or refreshed song with status match,
 * review, missing, refresh, or failed, and result.writes ({ custom, filled, kept }) when fields were
 * assigned. A Spotify rate limit too long to wait for stops the run: the songs not looked up yet are
 * counted as skipped and rateLimited.retryAfter (seconds) is returned.
 */
const matchSongs = async ({
  db,
  config,
  songs,
  client,
  beetsIds = new Map(),
  dryRun = false,
  refresh = false,
  recheckDays = defaultRecheckDays,
  refreshDays = _.get(config, 'spotify.refreshDays', 30),
  concurrency = 3,
  now = new Date(),
  onProgress = _.noop,
  onSong = _.noop
}) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const selectSong = db.prepare('SELECT id, duration FROM songs WHERE path = ?');
  const selectMatch = db.prepare(
    'SELECT status, track_id, source, checked_at, rejected FROM spotify_matches WHERE song_id = ?'
  );
  const recheckBefore = daysAgo(now, recheckDays);
  const refreshBefore = daysAgo(now, refreshDays);

  const counts = {
    targets: 0,
    tagged: 0,
    cached: 0,
    notInDatabase: 0,
    match: 0,
    review: 0,
    missing: 0,
    refresh: 0,
    failed: 0,
    skipped: 0,
    reused: 0
  };
  const bySource = { beets: 0, isrc: 0, search: 0 };
  const unassigned = {};
  const items = [];
  _.each(songs, ({ file, targets }) => {
    if (targets.length === 0) {
      return;
    }
    counts.targets += 1;
    const row = selectSong.get(path.relative(baseDirectory, file));
    if (!row) {
      counts.notInDatabase += 1;
      return;
    }
    const song = {
      artist: frameValue(db, row.id, 'TPE1'),
      title: frameValue(db, row.id, 'TIT2'),
      isrc: frameValue(db, row.id, 'TSRC'),
      duration: row.duration
    };
    const trackId = frameValue(db, row.id, spotifyIdFrame);
    if (trackId) {
      const fetchedAt = frameValue(db, row.id, fetchedAtFrame);
      if (!refresh && fetchedAt && new Date(fetchedAt) > refreshBefore) {
        counts.tagged += 1;
      } else {
        items.push({ file, songId: row.id, song, trackId });
      }
      return;
    }
    const cached = selectMatch.get(row.id);
    const rejected = new Set(cached && cached.rejected ? JSON.parse(cached.rejected) : []);
    // a match found before (e.g. by a dry run) is used without searching again
    if (cached && cached.status === 'match' && cached.track_id && !rejected.has(cached.track_id)) {
      items.push({
        file,
        songId: row.id,
        song,
        cachedMatch: { id: cached.track_id, source: cached.source }
      });
      return;
    }
    // a song whose match was rejected in review is looked up again right away
    if (
      cached &&
      !['match', 'rejected'].includes(cached.status) &&
      new Date(`${cached.checked_at.replace(' ', 'T')}Z`) > recheckBefore
    ) {
      counts.cached += 1;
      return;
    }
    items.push({ file, songId: row.id, song, rejected });
  });

  let done = 0;
  const finish = (status, item, result) => {
    counts[status] += 1;
    if (status === 'match') {
      bySource[result.source] += 1;
    }
    done += 1;
    onSong(status, item, result);
    onProgress({ done, total: items.length, ...counts });
  };

  const found = [];
  const upsert = db.prepare(
    `INSERT INTO spotify_matches (song_id, status, track_id, source, candidate, checked_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (song_id) DO UPDATE SET status = excluded.status, track_id = excluded.track_id,
       source = excluded.source, candidate = excluded.candidate, checked_at = excluded.checked_at`
  );
  // a long rate limit stops the lookups, the songs after it are skipped
  let rateLimit = null;
  for (const chunk of _.chunk(items, chunkSize)) {
    if (rateLimit) {
      counts.skipped += chunk.length;
      continue;
    }
    // songs with an id are only refreshed, the others are looked up first
    const looked = await Promise.map(
      chunk,
      async item => {
        if (item.trackId) {
          return { item, status: 'refresh', candidate: { id: item.trackId } };
        }
        if (item.cachedMatch) {
          counts.reused += 1;
          return {
            item,
            status: 'match',
            source: item.cachedMatch.source,
            candidate: { id: item.cachedMatch.id }
          };
        }
        if (rateLimit) {
          return { item, status: 'skipped' };
        }
        try {
          return {
            item,
            ...(await lookup({
              client,
              song: item.song,
              beetsId: beetsIds.get(item.file),
              rejected: item.rejected
            }))
          };
        } catch (err) {
          if (err.rateLimited) {
            rateLimit = rateLimit || err;
            return { item, status: 'skipped' };
          }
          return { item, status: 'failed', error: err.message };
        }
      },
      { concurrency }
    );

    const withFields = _.filter(looked, ({ status }) => ['match', 'refresh'].includes(status));
    let details = new Map();
    let detailsError = null;
    try {
      const known = new Map(
        _.compact(_.map(withFields, ({ track }) => track && [track.id, track]))
      );
      details = await fetchDetails(client, _.map(withFields, 'candidate.id'), config, known);
    } catch (err) {
      detailsError = err.message;
      if (err.rateLimited) {
        rateLimit = rateLimit || err;
      }
    }

    const written = [];
    const chunkFound = [];
    _.each(looked, result => {
      const { item, status } = result;
      if (status === 'skipped') {
        counts.skipped += 1;
        return;
      }
      if (status === 'failed') {
        finish('failed', item, result);
        return;
      }
      if (status !== 'refresh') {
        chunkFound.push({ ...item, ...result });
      }
      if (!['match', 'refresh'].includes(status)) {
        finish(status, item, result);
        return;
      }
      const objects = details.get(result.candidate.id);
      if (!objects) {
        // a match is still written by its id alone, a refresh without details is a failure
        const error = detailsError || `track ${result.candidate.id} not found on Spotify`;
        if (status === 'refresh') {
          finish('failed', item, { ...result, error });
          return;
        }
        const writes = {
          custom: [{ name: trackIdName, value: result.candidate.id }],
          filled: [],
          kept: []
        };
        const writeError = dryRun ? null : tryWrite(item.file, writes);
        if (writeError) {
          finish('failed', item, { ...result, error: writeError });
          return;
        }
        if (!dryRun) {
          written.push(item.file);
        }
        finish(status, item, { ...result, writes, error });
        return;
      }
      const assignment = assignFields(objects, config, now);
      _.each(assignment.unassigned, fieldPath => {
        unassigned[fieldPath] = (unassigned[fieldPath] || 0) + 1;
      });
      const writes = plannedWrites(db, config, item.songId, assignment);
      const writeError = dryRun ? null : tryWrite(item.file, writes);
      if (writeError) {
        finish('failed', item, { ...result, track: objects.track, error: writeError });
        return;
      }
      if (!dryRun) {
        written.push(item.file);
      }
      finish(status, item, { ...result, track: objects.track, writes });
    });

    // saved per chunk: the lookup cache always, the song tags only when files were written
    transaction(db, () =>
      chunkFound.forEach(({ songId, status, source, candidate }) =>
        upsert.run(
          songId,
          status,
          status === 'match' ? candidate.id : null,
          source,
          candidate ? JSON.stringify(candidate) : null
        )
      )
    );
    found.push(...chunkFound);
    if (written.length > 0) {
      await updateDatabase(db, { config, files: written, record: false });
    }
  }

  return {
    ...counts,
    bySource,
    unassigned,
    dryRun,
    rateLimited: rateLimit ? { retryAfter: rateLimit.retryAfter } : null,
    results: _.map(found, item => _.omit(item, ['track']))
  };
};

// songs waiting for review with their candidate; linked when the file already has the candidate's id
// (a match moved to review by recheckMatches), so it is on Spotify already
const reviewItems = (db, config) =>
  _.map(
    db
      .prepare(
        `SELECT s.id, s.path, m.candidate, m.source, s.duration,
           (SELECT value FROM song_tags WHERE song_id = s.id AND frame_id = ?) AS linked_id
         FROM spotify_matches m JOIN songs s ON s.id = m.song_id
         WHERE m.status = 'review' ORDER BY s.path`
      )
      .all(spotifyIdFrame),
    row => {
      const candidate = JSON.parse(row.candidate);
      return {
        songId: row.id,
        file: path.join(path.resolve(config.mpd.baseDirectory), row.path),
        path: row.path,
        duration: row.duration,
        source: row.source,
        candidate,
        linked: Boolean(row.linked_id) && row.linked_id === candidate.id
      };
    }
  );

/**
 * Moves matches whose Spotify title fails the current title rule (sameTitle) to review, for songs with
 * targets (songTargets). The files keep their Spotify id and fields, so nothing changes on Spotify until
 * the match is accepted or rejected. Matches accepted in review before are left alone. Returns the songs
 * moved; with dryRun nothing is written.
 */
const recheckMatches = ({ db, config, songs, dryRun = false }) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const selectSong = db.prepare('SELECT id, duration FROM songs WHERE path = ?');
  const selectMatch = db.prepare(
    'SELECT source, reviewed_at FROM spotify_matches WHERE song_id = ?'
  );
  const update = db.prepare(
    `INSERT INTO spotify_matches (song_id, status, track_id, source, candidate, checked_at)
     VALUES (?, 'review', ?, ?, ?, datetime('now'))
     ON CONFLICT (song_id) DO UPDATE SET status = 'review', track_id = excluded.track_id,
       candidate = excluded.candidate, checked_at = excluded.checked_at`
  );
  const moved = _.compact(
    _.map(
      _.filter(songs, ({ targets }) => targets.length > 0),
      ({ file }) => {
        const row = selectSong.get(path.relative(baseDirectory, file));
        const trackId = row && frameValue(db, row.id, spotifyIdFrame);
        if (!trackId) {
          return null;
        }
        const match = selectMatch.get(row.id);
        const title = frameValue(db, row.id, 'TIT2');
        const spotifyTitle = frameValue(db, row.id, 'TXXX.sp_title');
        if ((match && match.reviewed_at) || !spotifyTitle || sameTitle(title, spotifyTitle)) {
          return null;
        }
        const candidate = {
          id: trackId,
          name: spotifyTitle,
          artists: frameValue(db, row.id, 'TXXX.sp_artist'),
          album: frameValue(db, row.id, 'TXXX.sp_album'),
          durationMs: Number(frameValue(db, row.id, 'TXXX.sp_duration_ms')) || null
        };
        return {
          songId: row.id,
          file,
          source: _.get(match, 'source') || null,
          song: { artist: frameValue(db, row.id, 'TPE1'), title, duration: row.duration },
          candidate
        };
      }
    )
  );
  if (!dryRun) {
    transaction(db, () =>
      moved.forEach(({ songId, candidate, source }) =>
        update.run(songId, candidate.id, source, JSON.stringify(candidate))
      )
    );
  }
  return moved;
};

const markReviewed = (db, songId, status, trackId) =>
  db
    .prepare(
      `UPDATE spotify_matches SET status = ?, track_id = ?, reviewed_at = datetime('now')
       WHERE song_id = ?`
    )
    .run(status, trackId, songId);

/**
 * Accepts review items: a linked one (already tagged with the candidate) is only marked reviewed, others
 * get the candidate's id and Spotify fields written like a match. Returns { accepted, failed } items.
 */
const acceptReview = async ({ db, config, client, items, now = new Date() }) => {
  const [linked, unlinked] = _.partition(items, 'linked');
  linked.forEach(({ songId, candidate }) => markReviewed(db, songId, 'match', candidate.id));
  const details = unlinked.length
    ? await fetchDetails(client, _.map(unlinked, 'candidate.id'), config)
    : new Map();
  const failed = [];
  const written = [];
  unlinked.forEach(item => {
    const objects = details.get(item.candidate.id);
    const writes = objects
      ? plannedWrites(db, config, item.songId, assignFields(objects, config, now))
      : { custom: [{ name: trackIdName, value: item.candidate.id }], filled: [], kept: [] };
    const error = tryWrite(item.file, writes);
    if (error) {
      failed.push({ ...item, error });
      return;
    }
    written.push(item.file);
    markReviewed(db, item.songId, 'match', item.candidate.id);
  });
  if (written.length > 0) {
    await updateDatabase(db, { config, files: written, record: false });
  }
  return { accepted: _.reject(items, item => _.some(failed, { file: item.file })), failed };
};

/**
 * Rejects review items: the candidate is remembered as rejected for the song, so it is never matched
 * again and, when it was pushed, removed from Spotify by the next push; a linked song also loses its
 * Spotify id and fields. The songs are looked up again by the next sync --match.
 */
const rejectReview = async ({ db, config, items }) => {
  const select = db.prepare('SELECT rejected FROM spotify_matches WHERE song_id = ?');
  const update = db.prepare(
    `UPDATE spotify_matches SET status = 'rejected', track_id = NULL, rejected = ?, reviewed_at = NULL
     WHERE song_id = ?`
  );
  const failed = [];
  const written = [];
  items.forEach(item => {
    if (item.linked) {
      const result = rewriteTags(item.file, raw => ({
        ...raw,
        TXXX: _.reject([].concat(raw.TXXX || []), ({ description }) => /^sp_/.test(description))
      }));
      if (result instanceof Error) {
        failed.push({ ...item, error: result.message });
        return;
      }
      written.push(item.file);
    }
    const before = _.get(select.get(item.songId), 'rejected');
    const rejected = _.uniq([...(before ? JSON.parse(before) : []), item.candidate.id]);
    update.run(JSON.stringify(rejected), item.songId);
  });
  if (written.length > 0) {
    await updateDatabase(db, { config, files: written, record: false });
  }
  return { rejected: _.reject(items, item => _.some(failed, { file: item.file })), failed };
};

// Spotify track ids rejected in review, keyed by track id with the file of the song they were rejected for
const rejectedTracks = (db, config) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const rows = db
    .prepare(
      `SELECT s.path, m.rejected FROM spotify_matches m JOIN songs s ON s.id = m.song_id
       WHERE m.rejected IS NOT NULL`
    )
    .all();
  return new Map(
    _.flatMap(rows, ({ path: songPath, rejected }) =>
      JSON.parse(rejected).map(trackId => [trackId, path.join(baseDirectory, songPath)])
    )
  );
};

module.exports = {
  acceptReview,
  matchSongs,
  recheckMatches,
  rejectReview,
  rejectedTracks,
  reviewItems,
  spotifyIdFrame
};
