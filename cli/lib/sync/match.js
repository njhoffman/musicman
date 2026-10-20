const _ = require('lodash');
const path = require('path');
const NodeId3 = require('node-id3');
const Promise = require('bluebird');

const { bestCandidate, looseQuery, searchQuery } = require('../spotify/match.js');
const { transaction } = require('../db/database.js');
const { updateDatabase } = require('../db/update.js');

const spotifyIdFrame = 'TXXX.spotify_track_id';
const spotifyIdDescription = 'spotify_track_id';

// days before review and missing results are looked up again
const defaultRecheckDays = 30;

const frameValue = (db, songId, frameId) =>
  _.get(
    db
      .prepare('SELECT value FROM song_tags WHERE song_id = ? AND frame_id = ? LIMIT 1')
      .get(songId, frameId),
    'value'
  );

const writeSpotifyId = (file, trackId) =>
  NodeId3.update(
    { userDefinedText: [{ description: spotifyIdDescription, value: trackId }] },
    file
  );

const searchTracks = async (client, query, limit) =>
  _.get(
    await client.get(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`),
    'tracks.items',
    []
  );

// look up one song: beets id, then ISRC, then artist and title search
const lookup = async ({ client, song, beetsId }) => {
  if (beetsId) {
    return { status: 'match', source: 'beets', candidate: { id: beetsId } };
  }
  if (song.isrc) {
    const result = bestCandidate(song, await searchTracks(client, `isrc:${song.isrc}`, 5), {
      isrc: true
    });
    if (result.status !== 'missing') {
      return { ...result, source: 'isrc' };
    }
  }
  const strict = bestCandidate(song, await searchTracks(client, searchQuery(song), 10));
  if (strict.status === 'match') {
    return { ...strict, source: 'search' };
  }
  // the looser query only replaces a strict result it improves on
  const loose = bestCandidate(song, await searchTracks(client, looseQuery(song), 10));
  const rank = { match: 0, review: 1, missing: 2 };
  return { ...(rank[loose.status] < rank[strict.status] ? loose : strict), source: 'search' };
};

/**
 * Finds Spotify track ids for songs (from songTargets) that belong in a Spotify target and do not have
 * one yet. Confident matches are written to the files as TXXX.spotify_track_id and the database rows
 * refreshed; probable matches are kept for review; misses are remembered for recheckDays. With dryRun
 * nothing is written to files or the database.
 */
const matchSongs = async ({
  db,
  config,
  songs,
  client,
  beetsIds = new Map(),
  dryRun = false,
  recheckDays = defaultRecheckDays,
  concurrency = 3,
  now = new Date(),
  onProgress = _.noop,
  onSong = _.noop
}) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const selectSong = db.prepare('SELECT id, duration FROM songs WHERE path = ?');
  const selectMatch = db.prepare(
    'SELECT status, checked_at FROM spotify_matches WHERE song_id = ?'
  );
  const recheckBefore = new Date(now.getTime() - recheckDays * 24 * 60 * 60 * 1000);

  const counts = {
    targets: 0,
    tagged: 0,
    cached: 0,
    notInDatabase: 0,
    match: 0,
    review: 0,
    missing: 0,
    failed: 0
  };
  const bySource = { beets: 0, isrc: 0, search: 0 };
  const toLookup = [];
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
    if (frameValue(db, row.id, spotifyIdFrame)) {
      counts.tagged += 1;
      return;
    }
    const cached = selectMatch.get(row.id);
    if (
      cached &&
      cached.status !== 'match' &&
      new Date(`${cached.checked_at.replace(' ', 'T')}Z`) > recheckBefore
    ) {
      counts.cached += 1;
      return;
    }
    toLookup.push({
      file,
      songId: row.id,
      song: {
        artist: frameValue(db, row.id, 'TPE1'),
        title: frameValue(db, row.id, 'TIT2'),
        isrc: frameValue(db, row.id, 'TSRC'),
        duration: row.duration
      }
    });
  });

  let done = 0;
  const results = await Promise.map(
    toLookup,
    async item => {
      try {
        const result = await lookup({ client, song: item.song, beetsId: beetsIds.get(item.file) });
        counts[result.status] += 1;
        if (result.status === 'match') {
          bySource[result.source] += 1;
        }
        onSong(result.status, item, result);
        return { ...item, ...result };
      } catch (err) {
        counts.failed += 1;
        onSong('failed', item, { error: err.message });
        return null;
      } finally {
        done += 1;
        onProgress({ done, total: toLookup.length, ...counts });
      }
    },
    { concurrency }
  );

  const found = _.compact(results);
  if (!dryRun) {
    const matched = _.filter(found, { status: 'match' });
    matched.forEach(({ file, candidate }) => writeSpotifyId(file, candidate.id));
    if (matched.length > 0) {
      await updateDatabase(db, { config, files: _.map(matched, 'file'), record: false });
    }
    const upsert = db.prepare(
      `INSERT INTO spotify_matches (song_id, status, track_id, source, candidate, checked_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (song_id) DO UPDATE SET status = excluded.status, track_id = excluded.track_id,
         source = excluded.source, candidate = excluded.candidate, checked_at = excluded.checked_at`
    );
    transaction(db, () =>
      found.forEach(({ songId, status, source, candidate }) =>
        upsert.run(
          songId,
          status,
          status === 'match' ? candidate.id : null,
          source,
          candidate ? JSON.stringify(candidate) : null
        )
      )
    );
  }

  return { ...counts, bySource, dryRun, results: found };
};

// songs with probable matches waiting for review, with their candidate
const reviewItems = (db, config) =>
  _.map(
    db
      .prepare(
        `SELECT s.path, m.candidate, s.duration FROM spotify_matches m JOIN songs s ON s.id = m.song_id
         WHERE m.status = 'review' ORDER BY s.path`
      )
      .all(),
    row => ({
      file: path.join(path.resolve(config.mpd.baseDirectory), row.path),
      path: row.path,
      duration: row.duration,
      candidate: JSON.parse(row.candidate)
    })
  );

module.exports = { matchSongs, reviewItems, spotifyIdFrame };
