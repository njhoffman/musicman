const _ = require('lodash');
const path = require('path');

const { getMeta } = require('../db/database.js');
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
      const row = db.prepare('SELECT id, duration FROM songs WHERE path = ?').get(songPath);
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

module.exports = {
  acceptedList,
  candidateOfTrack,
  fetchRejected,
  rejectedList,
  reviewList,
  transferLists,
  unknownRejected
};
