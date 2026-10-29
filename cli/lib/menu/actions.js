const _ = require('lodash');

const { icons } = require('./menu.js');
const { escapeMarkup } = require('./rofi.js');
const parseFilters = require('../parser/options/filters.js');
const { filterTag } = require('../sync/membership.js');
const { refreshPlaylist } = require('../sync/cache.js');
const { localSpotifyIds } = require('../sync/plan.js');
const { cachedIn, changeTrack, pushSong } = require('../sync/song.js');
const { ignorePlaylistId, likedId, playlistTargets } = require('../sync/targets.js');

// keys the playback controls, ratings, like and ignore use; tag buttons without a key get the next free
// one of buttonKeys
const likeKey = 'y';
const ignoreKey = 'x';
const buttonKeys = 'asdfgjkzcvbmoweru'.split('');

const sameTag = (a, b) =>
  Boolean(a && b) && a.field === b.field && _.toLower(a.value) === _.toLower(b.value);

// the exact rating of a filter like rating:4.5-4.5, else null
const exactRating = (filter, config) => {
  const { rating } = parseFilters(filter.split(/\s+(?=~?[\w]+:)/), config, 'sync');
  const min = Number(rating.min);
  return rating.min && !rating.exclude && min === Number(rating.max) && !_.isNaN(min) ? min : null;
};

/**
 * The menu's tag and rating buttons from menu.buttons and menu.ratings, each with the sync.playlists
 * target of the same filter (or exact rating), used for Spotify songs that are not in the library.
 * Throws for a button whose filter is not one value of a multi value field (context:Study).
 */
const menuButtons = config => {
  const targets = playlistTargets(config);
  const used = new Set(_.compact(_.map(_.get(config, 'menu.buttons'), 'key')));
  const free = _.reject(buttonKeys, key => used.has(key));
  const tags = _.map(_.get(config, 'menu.buttons') || [], (button, i) => {
    const tag = _.isString(button.filter) ? filterTag(button.filter, config) : null;
    if (!tag) {
      throw new Error(
        `menu.buttons[${i}].filter '${button.filter}' must be one value of a multi value field, e.g. context:Study`
      );
    }
    const target = _.find(targets, ({ filter }) => sameTag(filterTag(filter, config), tag));
    return {
      ...tag,
      label: button.label || tag.value,
      key: button.key || free.shift(),
      icon: button.icon || icons.tag,
      playlistId: target ? target.id : null
    };
  });
  const ratings = _.map(_.get(config, 'menu.ratings') || [], (value, i) => {
    const target = _.find(targets, ({ filter }) => exactRating(filter, config) === Number(value));
    return {
      value: Number(value).toFixed(1),
      label: Number(value).toFixed(1),
      key: `${i + 1}`,
      icon: icons.rating,
      playlistId: target ? target.id : null
    };
  });
  return { tags, ratings };
};

const hasValue = (meta, { field, value }) =>
  _.some(
    `${(meta && meta[field]) || ''}`.split(','),
    item => _.toLower(item.trim()) === _.toLower(value)
  );

const stars = rating => {
  const value = Number(rating) || 0;
  return `${'★'.repeat(Math.floor(value))}${value % 1 ? '½' : ''}`;
};

// the song's rating and multi value fields for the details, as Pango markup lines
const songDetails = (meta, fields) => [
  `${meta.rating ? `${escapeMarkup(stars(meta.rating))}  ${escapeMarkup(meta.rating)}` : 'unrated'}`,
  ..._.compact(
    _.map(fields, field => {
      // stored values can carry empty items (a trailing comma), shown without them
      const values = _.compact(_.map(`${meta[field] || ''}`.split(','), _.trim));
      return values.length
        ? `${escapeMarkup(field)}  <b>${escapeMarkup(values.join(', '))}</b>`
        : null;
    })
  )
];

/**
 * The song buttons of the menu (see Menu songActions): a tag button per menu.buttons entry, a rating
 * button per menu.ratings value, like and ignore. MPD songs and Spotify songs in the library (by their
 * Spotify id) get local tag changes, for Spotify ones pushed to Spotify right away (pushSong); Spotify
 * songs not in the library are added to or removed from the matching sync.playlists target, Liked Songs,
 * or sync.ignorePlaylist. Like and ignore only apply to songs not in the library, whose Liked Songs
 * membership follows sync.likedRating. Each action runs as its own archived run (withRun), so musicman
 * undo takes back one press at a time.
 * Dependencies: openDb() opens the library database, client() the Spotify user client, readSongs(files)
 * and writeSong(file, assignments) read and write tags as [file, metadata], withRun(label, fn).
 */
const songActions = ({ config, openDb, client, readSongs, writeSong, withRun }) => {
  const buttons = menuButtons(config);
  const likedRating = _.get(config, 'sync.likedRating', 4.5);
  const ignoreId = ignorePlaylistId(config);
  const fields = _.uniq(_.map(buttons.tags, 'field'));

  const withDb = async fn => {
    const db = openDb();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };

  // the local file of the playing song (MPD's, or the first linked to the Spotify track) and its tags
  const song = async ({ player, track }) => {
    if (!track) {
      return {};
    }
    const file =
      player.source === 'mpd'
        ? track.file
        : await withDb(db => {
            const ids = localSpotifyIds(db, config);
            return (
              _.find([...ids.keys()], candidate => ids.get(candidate) === track.trackId) || null
            );
          });
    if (!file) {
      return {
        file: null,
        meta: null,
        details: ['<i>not in the library</i>'],
        status: ['not in library']
      };
    }
    const [[, meta] = []] = await readSongs([file]);
    return {
      file,
      meta: meta || {},
      details: songDetails(meta || {}, fields),
      status: player.source === 'spotify' ? ['in library'] : []
    };
  };

  // a local tag change, pushed to Spotify right away for a Spotify song
  const writeLocal = async ({ player, track, song: current }, assignments) => {
    const label = `${_.map(assignments, (value, field) => `${field}=${[].concat(value).join(',')}`).join(' ')}`;
    return withRun(`${label} ${track.artist} - ${track.title}`, async () => {
      const after = await writeSong(current.file, assignments);
      if (player.source !== 'spotify') {
        return { file: current.file, assignments };
      }
      const pushed = await withDb(async db =>
        pushSong({
          db,
          client: client(),
          config,
          file: current.file,
          before: current.meta,
          after,
          readSongs
        })
      );
      return { file: current.file, assignments, pushed };
    });
  };

  // adds a Spotify-only track to a target or removes it, the playlist refreshed first so it is never
  // added twice
  const toggleRemote = (track, targetId, add, label) =>
    withRun(`${label} ${track.artist} - ${track.title}`, () =>
      withDb(async db => {
        const spotify = client();
        if (targetId !== likedId) {
          await refreshPlaylist(db, spotify, targetId);
        }
        const present = cachedIn(db, targetId, track.trackId);
        if (present === add) {
          return { unchanged: targetId };
        }
        return changeTrack({
          db,
          client: spotify,
          targetId,
          trackId: track.trackId,
          action: add ? 'add' : 'remove',
          meta: track,
          synced: false
        });
      })
    );

  const entries = async ({ player, track, song: current }) => {
    const local = Boolean(current && current.file);
    const remote = !local && player.source === 'spotify' && Boolean(track);
    const inTarget = await withDb(db => {
      const ids = _.compact([
        ..._.map(buttons.tags, 'playlistId'),
        ..._.map(buttons.ratings, 'playlistId'),
        likedId,
        ignoreId
      ]);
      return remote ? new Set(_.filter(ids, id => cachedIn(db, id, track.trackId))) : new Set();
    });

    const tagEntries = _.map(buttons.tags, button => {
      const active = local ? hasValue(current.meta, button) : inTarget.has(button.playlistId);
      return {
        icon: button.icon,
        label: button.label,
        key: button.key,
        active,
        disabled: !track || (!local && !(remote && button.playlistId)),
        run: () =>
          local
            ? writeLocal(
                { player, track, song: current },
                { [button.field]: [`${active ? '-' : '+'}${button.value}`] }
              )
            : toggleRemote(
                track,
                button.playlistId,
                !active,
                `${button.field}=${active ? '-' : '+'}${button.value}`
              )
      };
    });

    const ratingEntries = _.map(buttons.ratings, button => {
      const active = local
        ? Number(_.get(current, 'meta.rating')) === Number(button.value)
        : inTarget.has(button.playlistId);
      return {
        icon: button.icon,
        label: `rating ${button.label}`,
        caption: button.label,
        key: button.key,
        active,
        // a rating is set, never cleared, from the menu: pressing the current one does nothing
        disabled: !track || active || (!local && !(remote && button.playlistId)),
        run: async () => {
          if (local) {
            return writeLocal({ player, track, song: current }, { rating: button.value });
          }
          // a Spotify-only song is in one rating playlist at a time
          const others = _.filter(
            buttons.ratings,
            other => other !== button && inTarget.has(other.playlistId)
          );
          for (const other of others) {
            await toggleRemote(track, other.playlistId, false, `rating=-${other.value}`);
          }
          return toggleRemote(track, button.playlistId, true, `rating=${button.value}`);
        }
      };
    });

    const liked = local
      ? Number(_.get(current, 'meta.rating')) >= likedRating
      : inTarget.has(likedId);
    const ignored = inTarget.has(ignoreId);
    return [
      ...tagEntries,
      ...ratingEntries,
      {
        icon: icons.like,
        label: liked ? 'unlike' : 'like',
        caption: local ? 'liked' : 'like',
        key: likeKey,
        active: liked,
        // songs in the library are in Liked Songs by their rating
        disabled: !remote,
        run: () => toggleRemote(track, likedId, !liked, liked ? 'unlike' : 'like')
      },
      {
        icon: icons.ignore,
        label: ignored ? 'unignore' : 'ignore',
        caption: 'ignore',
        key: ignoreKey,
        active: ignored,
        disabled: !remote || !ignoreId,
        run: () => toggleRemote(track, ignoreId, !ignored, ignored ? 'unignore' : 'ignore')
      }
    ];
  };

  return { song, entries, buttons };
};

module.exports = { exactRating, hasValue, menuButtons, songActions, songDetails, stars };
