const _ = require('lodash');

const { toRawTags } = require('../db/read.js');
const { parseMetadata } = require('../metadata/read.js');
const { playlistTargets } = require('../sync/targets.js');

/**
 * Groups of mapped Spotify playlists a song belongs in at most one of: playlists whose sync.playlists
 * filter is one field:value term on a field holding one value (grouping, rating; not multi value fields
 * like context), grouped by that field. A playlist several filters map to (grouping:X.Artists and
 * grouping:X.Singles) is one member. Groups with a single playlist are left out.
 */
const exclusiveGroups = config => {
  const multi = new Set(_.map(_.filter(_.get(config, 'library.tags'), 'multi'), 'name'));
  const single = _.compact(
    _.map(playlistTargets(config), target => {
      const match = /^([\w-]+):(\S+)$/.exec(`${target.filter}`.trim());
      return match && !multi.has(match[1]) ? { ...target, field: match[1] } : null;
    })
  );
  return _.compact(
    _.map(_.groupBy(single, 'field'), (targets, field) =>
      _.uniq(_.map(targets, 'id')).length > 1 ? { field, targets } : null
    )
  );
};

// parsed metadata ([file, meta] as the filters take it) of the checked songs, from the database
const storedSongs = (db, config, songs) => {
  const rows = _.groupBy(
    db
      .prepare(
        `SELECT t.song_id, t.frame_id, t.value FROM song_tags t JOIN check_scope s ON s.id = t.song_id
         ORDER BY t.rowid`
      )
      .all(),
    'song_id'
  );
  return _.map(songs, song => [
    song.path,
    parseMetadata(toRawTags(song, rows[song.id] || []), config)
  ]);
};

/**
 * Songs and Spotify tracks in more than one playlist of an exclusive group (exclusiveGroups): songs
 * whose tags match filters of two playlists of a group, and tracks in two playlists of a group on
 * Spotify (the playlist cache of the last sync), with the playlists the local tags call for.
 */
const exclusive = ({ db, config, songs }) => {
  const groups = exclusiveGroups(config);
  if (groups.length === 0) {
    return [];
  }
  const names = new Map(
    _.map(db.prepare('SELECT id, name FROM spotify_playlists').all(), ({ id, name }) => [id, name])
  );
  const nameOf = id => names.get(id) || id;
  const stored = storedSongs(db, config, songs);
  const metaByPath = new Map(stored);
  // tracks no song is linked to are only reported when the whole library is checked
  const wholeLibrary =
    songs.length === db.prepare('SELECT COUNT(*) AS count FROM songs').get().count;
  // every file linked to each track, checked or not
  const pathsByTrack = _.groupBy(
    db
      .prepare(
        `SELECT songs.path, t.value FROM song_tags t JOIN songs ON songs.id = t.song_id
         WHERE t.frame_id = 'TXXX.sp_track_id'`
      )
      .all(),
    'value'
  );
  // the playlists of a group a song's tags put it in
  const belongs = (group, songPath) =>
    _.uniq(
      _.map(
        _.filter(group.targets, ({ matches }) => matches([songPath, metaByPath.get(songPath)])),
        'id'
      )
    );

  return _.flatMap(groups, group => {
    const local = _.compact(
      _.map(stored, ([songPath]) => {
        const ids = belongs(group, songPath);
        return ids.length > 1
          ? {
              file: songPath,
              detail: `${group.field}: tags match ${_.map(ids, nameOf).join(', ')}`,
              field: group.field,
              playlists: ids
            }
          : null;
      })
    );
    const ids = _.uniq(_.map(group.targets, 'id'));
    const tracks = db
      .prepare(
        `SELECT playlist_id, track_id, name, artists FROM spotify_playlist_tracks
         WHERE track_id IS NOT NULL AND playlist_id IN (${ids.map(() => '?').join(', ')})`
      )
      .all(...ids);
    const remote = _.compact(
      _.map(_.groupBy(tracks, 'track_id'), (rows, trackId) => {
        // in the order of sync.playlists, so findings read the same on every run
        const inPlaylists = _.sortBy(_.uniq(_.map(rows, 'playlist_id')), id => ids.indexOf(id));
        const linked = _.map(pathsByTrack[trackId], 'path');
        const files = _.filter(linked, songPath => metaByPath.has(songPath));
        // tracks of checked songs, and of no song at all when the whole library is checked
        if (
          inPlaylists.length < 2 ||
          (files.length === 0 && (linked.length > 0 || !wholeLibrary))
        ) {
          return null;
        }
        const perFile = _.map(files, songPath => ({ songPath, ids: belongs(group, songPath) }));
        const wanted = _.uniq(_.flatMap(perFile, 'ids'));
        const say = ids => (ids.length ? _.map(ids, nameOf).join(', ') : 'none of them');
        // copies of the song that disagree are what put the track in both playlists
        const disagree = _.uniqBy(perFile, ({ ids }) => _.sortBy(ids).join()).length > 1;
        const expected =
          files.length === 0
            ? 'not in the library'
            : disagree
              ? `copies disagree: ${_.map(perFile, ({ songPath, ids }) => `${songPath} says ${say(ids)}`).join('; ')}`
              : `tags say ${say(wanted)}`;
        return {
          file: files[0] || null,
          detail: `${group.field}: ${rows[0].artists} - ${rows[0].name} on Spotify in ${_.map(inPlaylists, nameOf).join(', ')}; ${expected}`,
          field: group.field,
          trackId,
          playlists: inPlaylists,
          expected: wanted
        };
      })
    );
    return [...local, ..._.sortBy(remote, 'detail')];
  });
};

module.exports = { exclusive, exclusiveGroups };
