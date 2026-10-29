const _ = require('lodash');
const path = require('path');

const { refreshPlaylist } = require('./cache.js');
const { localSpotifyIds } = require('./plan.js');
const { playlistRequest, uri } = require('./push.js');
const { likedId, songTargets } = require('./targets.js');
const { recordSpotify } = require('../history/journal.js');

// whether the cache has a track in a target (Liked Songs or a playlist)
const cachedIn = (db, targetId, trackId) =>
  Boolean(
    db
      .prepare('SELECT 1 FROM spotify_playlist_tracks WHERE playlist_id = ? AND track_id = ?')
      .get(targetId, trackId)
  );

const targetName = (db, id) =>
  id === likedId
    ? 'Liked Songs'
    : _.get(db.prepare('SELECT name FROM spotify_playlists WHERE id = ?').get(id), 'name') || id;

/**
 * Keeps the cache and the last synced state in step with a change made to one track, so the next sync
 * sees it as in sync rather than as a change made on Spotify. synced false leaves the synced state alone,
 * for tracks that are not in the library.
 */
const recordChange = (db, { targetId, trackId, action, meta = {}, synced = true }) => {
  if (action === 'add') {
    // a target never cached gets a row without a snapshot, so the next refresh fetches it whole
    db.prepare('INSERT OR IGNORE INTO spotify_playlists (id, name) VALUES (?, ?)').run(
      targetId,
      targetId === likedId ? 'Liked Songs' : targetId
    );
    if (!cachedIn(db, targetId, trackId)) {
      db.prepare(
        `INSERT INTO spotify_playlist_tracks (playlist_id, track_id, is_local, name, artists, album, added_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`
      ).run(
        targetId,
        trackId,
        meta.title || null,
        meta.artist || null,
        meta.album || null,
        new Date().toISOString()
      );
    }
    if (synced) {
      db.prepare('INSERT OR IGNORE INTO spotify_synced (playlist_id, track_id) VALUES (?, ?)').run(
        targetId,
        trackId
      );
    }
  } else {
    db.prepare('DELETE FROM spotify_playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(
      targetId,
      trackId
    );
    db.prepare('DELETE FROM spotify_synced WHERE playlist_id = ? AND track_id = ?').run(
      targetId,
      trackId
    );
  }
};

/**
 * Adds a track to a Spotify target or removes it from one, recorded for musicman undo, and keeps the
 * cache and the synced state in step (recordChange).
 */
const changeTrack = async ({ db, client, targetId, trackId, action, meta, synced = true }) => {
  if (targetId === likedId) {
    await client.request(action === 'add' ? 'PUT' : 'DELETE', '/me/tracks', { ids: [trackId] });
  } else {
    await playlistRequest(client, action === 'add' ? 'POST' : 'DELETE', targetId, [uri(trackId)]);
  }
  recordSpotify({
    target: { id: targetId, name: targetName(db, targetId) },
    action,
    trackIds: [trackId]
  });
  recordChange(db, { targetId, trackId, action, meta, synced });
  return { id: targetId, name: targetName(db, targetId), action };
};

/**
 * Pushes one song's tag change (before and after are its metadata) to Spotify right away, without a
 * whole sync: for each target the change moved the song into or out of (songTargets), its track is
 * added or removed, unless another copy of the song (readSongs reads them as [file, metadata]) keeps it
 * there. Playlists are refreshed first so a track is never added twice; Liked Songs is taken from the
 * cache. Songs without a Spotify id or outside sync.scope are left alone. Returns the changes made.
 */
const pushSong = async ({ db, client, config, file, before, after, readSongs }) => {
  const ids = localSpotifyIds(db, config);
  const songFile = path.resolve(file);
  const trackId = ids.get(songFile);
  if (!trackId) {
    return [];
  }
  const [was, now] = songTargets(
    [
      [songFile, before],
      [songFile, after]
    ],
    config
  );
  if (was.outOfScope || now.outOfScope) {
    return [];
  }
  const changed = _.xor(was.targets, now.targets);
  if (changed.length === 0) {
    return [];
  }
  const copies = _.filter([...ids.keys()], copy => copy !== songFile && ids.get(copy) === trackId);
  const kept = new Set(
    copies.length
      ? _.flatMap(_.reject(songTargets(await readSongs(copies), config), 'outOfScope'), 'targets')
      : []
  );
  const results = [];
  for (const targetId of changed) {
    const belongs = now.targets.includes(targetId) || kept.has(targetId);
    if (targetId !== likedId) {
      await refreshPlaylist(db, client, targetId);
    }
    const present = cachedIn(db, targetId, trackId);
    if (belongs && !present) {
      results.push(
        await changeTrack({ db, client, targetId, trackId, action: 'add', meta: after })
      );
    } else if (!belongs && present) {
      results.push(
        await changeTrack({ db, client, targetId, trackId, action: 'remove', meta: after })
      );
    } else if (belongs) {
      recordChange(db, { targetId, trackId, action: 'add', meta: after });
    }
  }
  return results;
};

module.exports = { cachedIn, changeTrack, pushSong, targetName };
