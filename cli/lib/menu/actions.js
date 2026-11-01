const _ = require('lodash');
const fs = require('fs');

const { chipColors, clock, defaultChip, icons, tones } = require('./menu.js');
const { escapeMarkup } = require('./rofi.js');
const parseFilters = require('../parser/options/filters.js');
const { libraryFileForTrack } = require('../player/library.js');
const { filterTag } = require('../sync/membership.js');
const { refreshPlaylist } = require('../sync/cache.js');
const { cachedIn, changeTrack, pushSong } = require('../sync/song.js');
const { ignorePlaylistId, likedId, playlistTargets } = require('../sync/targets.js');

// keys of the main menu's song buttons, besides the playback controls, shuffle (u), repeat (r),
// reshuffle (o) and ratings (1, 2, ...)
const likeKey = 'y';
const ignoreKey = 'x';
const groupingKey = 'g';
const tagsKey = 'e';
const detailsKey = 'i';

// pinned tags (menu.buttons) answer Alt+<key> in the tags submenu, where plain letters filter; those
// without a key get the next free one of buttonKeys
const buttonKeys = 'asdfjkzcvbmwe'.split('');
const pinnedKey = key => `Alt+${key}`;

// the fields of the tags submenu and how many songs a value needs to be listed there, unless set in
// menu.tagFields and menu.tagMinSongs
const defaultTagFields = ['picks', 'context', 'mood'];
const defaultTagMinSongs = 5;

// layout of the submenus: buttons per row, lines of text per button, rows shown before scrolling
const tagsLayout = { columns: 6, height: 2, maxLines: 7 };
const groupingLayout = { columns: 4, height: 2, maxLines: 7 };
const detailsLayout = { columns: 1, height: 1, maxLines: 18, align: 'left' };

// width of the field names in the details, so the values line up
const detailsFieldWidth = 22;

// grouping values used in the library, most used first
const libraryGroupings = (db, frameId) =>
  _.map(
    db
      .prepare(
        `SELECT value, COUNT(*) AS count FROM song_tags WHERE frame_id = ?
         GROUP BY value ORDER BY count DESC, value`
      )
      .all(frameId),
    'value'
  );

// the sync.playlists targets of exactly one grouping (filter grouping:<value>), as { value, id }
const groupingTargets = config =>
  _.compact(
    _.map(playlistTargets(config), ({ id, filter }) => {
      const match = /^grouping:(\S+)$/i.exec(_.trim(filter));
      return match ? { value: match[1], id } : null;
    })
  );

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

/**
 * The fields of the tags submenu (menu.tagFields) as { name, id }; throws for a configured one that is
 * not a multi value field of library.tags. Of the default fields, those the library lacks are left out.
 */
const tagFields = config => {
  const configured = _.get(config, 'menu.tagFields');
  const fieldOf = name => {
    const tag = _.find(_.get(config, 'library.tags'), { name });
    return tag && tag.multi ? { name, id: tag.id } : null;
  };
  if (!configured) {
    return _.compact(_.map(defaultTagFields, fieldOf));
  }
  return _.map(configured, name => {
    const field = fieldOf(name);
    if (!field) {
      throw new Error(`menu.tagFields: '${name}' is not a multi value field of library.tags`);
    }
    return field;
  });
};

// tags added by hand to the tags submenu (menu.extraTags), as { field, value }; throws for one that is
// not one value of a menu.tagFields field
const extraTags = (config, fields) =>
  _.map(_.get(config, 'menu.extraTags') || [], (filter, i) => {
    const tag = _.isString(filter) ? filterTag(filter, config) : null;
    if (!tag || !_.some(fields, { name: tag.field })) {
      throw new Error(
        `menu.extraTags[${i}] '${filter}' must be one value of a menu.tagFields field, e.g. mood:Mellow`
      );
    }
    return tag;
  });

/**
 * The values of fields used in the library as { field, value, count }, most used first. Values that
 * differ only in case are one, spelled the way most songs spell it.
 */
const libraryTagValues = (db, fields) => {
  if (!fields.length) {
    return [];
  }
  const byId = _.keyBy(fields, 'id');
  const rows = db
    .prepare(
      `SELECT frame_id, value, COUNT(*) AS count FROM song_tags
       WHERE frame_id IN (${_.map(fields, () => '?').join(', ')})
       GROUP BY frame_id, value`
    )
    .all(..._.map(fields, 'id'));
  const merged = _.map(
    _.groupBy(
      _.filter(rows, ({ value }) => _.trim(value)),
      ({ frame_id: id, value }) => `${id}\u0000${_.toLower(_.trim(value))}`
    ),
    group => ({
      field: byId[group[0].frame_id].name,
      value: _.trim(_.maxBy(group, 'count').value),
      count: _.sumBy(group, 'count')
    })
  );
  return _.orderBy(merged, ['count', 'value'], ['desc', 'asc']);
};

/**
 * The tags listed in the tags submenu, as { field, value, pinned }: the pinned ones (menu.buttons)
 * first, then per field (in menu.tagFields order) the values on at least minSongs songs, most used
 * first, then the song's own values and menu.extraTags not listed yet. Each tag is listed once.
 */
const tagList = ({ pinned, fields, values, extras, songTags, minSongs }) => {
  const listed = [];
  const add = (tag, extra = {}) => {
    if (!_.some(listed, other => sameTag(other, tag))) {
      listed.push({ field: tag.field, value: tag.value, ...extra });
    }
  };
  _.each(pinned, button => add(button, { pinned: button }));
  _.each(fields, ({ name }) => {
    _.each(_.filter(values, { field: name }), tag => tag.count >= minSongs && add(tag));
    _.each(_.sortBy(_.filter([...songTags, ...extras], { field: name }), 'value'), tag => add(tag));
  });
  return listed;
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

// the values of a multi value field; stored values can carry empty items (a trailing comma)
const valuesOf = (meta, field) =>
  _.compact(_.map(`${(meta && meta[field]) || ''}`.split(','), _.trim));

// a tag of the song in the details, colored per field
const chip = (field, value) => {
  const [foreground, background] = chipColors[field] || defaultChip;
  return `<span foreground="${foreground}" background="${background}"> ${
    icons[field] || icons.tag
  } ${escapeMarkup(value)} </span>`;
};

// the song's rating, grouping and year, then its tags of fields as chips, as Pango markup lines
const songDetails = (meta, fields) => {
  const rating = meta.rating
    ? `<span foreground="${tones.rating}">${escapeMarkup(stars(meta.rating))}</span>  ${escapeMarkup(
        meta.rating
      )}`
    : '<span alpha="50%">unrated</span>';
  const more = _.compact([
    meta.grouping && `${icons.grouping}  ${escapeMarkup(meta.grouping)}`,
    meta.year && escapeMarkup(meta.year)
  ]);
  const chips = _.flatMap(fields, field =>
    _.map(valuesOf(meta, field), value => chip(field, value))
  );
  return _.compact([
    [rating, ..._.map(more, text => `<span alpha="65%">${text}</span>`)].join('     '),
    chips.length ? chips.join('  ') : null
  ]);
};

// a line of the details: the field name, padded so the values line up, and its value
const detailRow = (field, value) => ({ label: `${field.padEnd(detailsFieldWidth)}${value}` });

const fileSize = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * The details screen of a song: the file (path, size, modified) and every tag with a value, or the
 * track as Spotify plays it when the song is not in the library; then its Spotify link and the cached
 * Spotify playlists it is in.
 */
const songInfo = ({ track, file, meta, playlists, stat = fs.statSync }) => {
  const rows = [];
  if (file) {
    rows.push(detailRow('file', file));
    try {
      const { size, mtime } = stat(file);
      rows.push(detailRow('size', fileSize(size)));
      rows.push(detailRow('modified', mtime.toISOString().slice(0, 16).replace('T', ' ')));
    } catch {
      rows.push(detailRow('size', 'file not found'));
    }
    _.each(meta, (value, field) => {
      const text = _.compact(
        _.map(`${value === null || value === undefined ? '' : value}`.split(','), _.trim)
      );
      if (text.length) {
        rows.push(detailRow(field, text.join(', ')));
      }
    });
  } else {
    _.each(['title', 'artist', 'album'], field => {
      if (track[field]) {
        rows.push(detailRow(field, track[field]));
      }
    });
    if (track.duration) {
      rows.push(detailRow('length', clock(track.duration)));
    }
    rows.push(detailRow('library', 'not in the library'));
  }
  const trackId = track.trackId || _.get(meta, 'sp_track_id');
  if (trackId) {
    rows.push(detailRow('spotify', `https://open.spotify.com/track/${trackId}`));
    rows.push(detailRow('uri', `spotify:track:${trackId}`));
  }
  if (playlists.length) {
    rows.push(detailRow('playlists', playlists.join(', ')));
  }
  return rows;
};

// names of the cached Spotify playlists (and Liked Songs) a track is in
const playlistNames = (db, trackId) =>
  trackId
    ? _.map(
        db
          .prepare(
            `SELECT DISTINCT p.name FROM spotify_playlist_tracks t
             JOIN spotify_playlists p ON p.id = t.playlist_id
             WHERE t.track_id = ? ORDER BY p.name`
          )
          .all(trackId),
        'name'
      )
    : [];

/**
 * The song buttons of the menu (see Menu songActions): details, genre (the grouping tag), tags (a
 * submenu of the menu.tagFields values, menu.buttons pinned first), a rating button per menu.ratings
 * value, like and ignore. MPD songs and Spotify songs in the library (by their Spotify id) get local tag
 * changes, for Spotify ones pushed to Spotify right away (pushSong); Spotify songs not in the library
 * are added to or removed from the matching sync.playlists target, Liked Songs, or sync.ignorePlaylist.
 * Like and ignore only apply to songs not in the library, whose Liked Songs membership follows
 * sync.likedRating. Each action runs as its own archived run (withRun), so musicman undo takes back one
 * press at a time.
 * Dependencies: openDb() opens the library database, client() the Spotify user client, readSongs(files)
 * and writeSong(file, assignments) read and write tags as [file, metadata], withRun(label, fn), and
 * stat(file) (fs.statSync) for the details.
 */
const songActions = ({
  config,
  openDb,
  client,
  readSongs,
  writeSong,
  withRun,
  stat = fs.statSync
}) => {
  const buttons = menuButtons(config);
  const fields = tagFields(config);
  const extras = extraTags(config, fields);
  const minSongs = _.get(config, 'menu.tagMinSongs', defaultTagMinSongs);
  const fieldNames = _.map(fields, 'name');
  const targets = playlistTargets(config);
  // the sync.playlists target of one tag (an entry whose filter is just field:value), else null
  const tagPlaylist = tag =>
    _.get(
      _.find(targets, ({ filter }) => sameTag(filterTag(filter, config), tag)),
      'id',
      null
    );
  const likedRating = _.get(config, 'sync.likedRating', 4.5);
  const ignoreId = ignorePlaylistId(config);
  const groupingFrame = _.get(_.find(_.get(config, 'library.tags'), { name: 'grouping' }), 'id');
  const groupings = groupingTargets(config);
  const groupingPlaylist = value =>
    _.get(
      _.find(groupings, ({ value: mapped }) => _.toLower(mapped) === _.toLower(value)),
      'id',
      null
    );

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
        : await withDb(db => libraryFileForTrack(db, config, track.trackId));
    if (!file) {
      return {
        file: null,
        meta: null,
        details: ['<span alpha="60%"><i>not in the library</i></span>'],
        status: ['not in library']
      };
    }
    const [[, meta] = []] = await readSongs([file]);
    return {
      file,
      meta: meta || {},
      details: songDetails(meta || {}, fieldNames),
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

  /**
   * Whether Spotify has the track in Liked Songs now, with the cached Liked Songs corrected to match;
   * null (the cache stays as it is) when Spotify cannot be asked. The cache is refreshed only by sync,
   * so a song liked in the app since would show as not liked, and pressing like would record an add
   * that undo then removes.
   */
  const likedNow = async (db, trackId) => {
    let liked;
    try {
      [liked] = await client().get(`/me/tracks/contains?ids=${encodeURIComponent(trackId)}`);
    } catch {
      return null;
    }
    if (!_.isBoolean(liked)) {
      return null;
    }
    if (liked !== cachedIn(db, likedId, trackId)) {
      try {
        if (liked) {
          db.prepare(
            'INSERT INTO spotify_playlist_tracks (playlist_id, track_id) VALUES (?, ?)'
          ).run(likedId, trackId);
        } else {
          db.prepare(
            'DELETE FROM spotify_playlist_tracks WHERE playlist_id = ? AND track_id = ?'
          ).run(likedId, trackId);
        }
      } catch {
        // no cached Liked Songs yet (no sync has run), the live answer still counts
      }
    }
    return liked;
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
        const live = targetId === likedId ? await likedNow(db, track.trackId) : null;
        const present = live === null ? cachedIn(db, targetId, track.trackId) : live;
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
    const context = { player, track, song: current };
    const inTarget = await withDb(db => {
      const ids = _.compact([
        ..._.map(targets, 'id'),
        ..._.map(buttons.ratings, 'playlistId'),
        likedId,
        ignoreId
      ]);
      return remote
        ? new Set(_.filter(_.uniq(ids), id => cachedIn(db, id, track.trackId)))
        : new Set();
    });
    const likedLive = remote ? await withDb(db => likedNow(db, track.trackId)) : null;

    // a tag of a library song, or the playlist of the tag a Spotify-only song is in; pressing it adds
    // or removes the tag (or the track)
    const tagEntry = (tag, extra = {}) => {
      const playlistId = tagPlaylist(tag);
      const active = local ? hasValue(current.meta, tag) : inTarget.has(playlistId);
      const change = `${tag.field}=${active ? '-' : '+'}${tag.value}`;
      return {
        icon: icons[tag.field] || icons.tag,
        label: tag.value,
        field: tag.field,
        active,
        disabled: !track || (!local && !(remote && playlistId)),
        run: () =>
          local
            ? writeLocal(context, { [tag.field]: [`${active ? '-' : '+'}${tag.value}`] })
            : toggleRemote(track, playlistId, !active, change),
        ...extra
      };
    };

    // the tags the song has: its values of the tag fields, or the tag playlists a Spotify-only song is in
    const songTags = local
      ? _.flatMap(fieldNames, field =>
          _.map(valuesOf(current.meta, field), value => ({ field, value }))
        )
      : _.compact(
          _.map(targets, ({ id, filter }) => {
            const tag = inTarget.has(id) ? filterTag(filter, config) : null;
            return tag && fieldNames.includes(tag.field) ? tag : null;
          })
        );

    const tagsEntry = {
      icon: icons.tags,
      label: 'tags',
      caption: songTags.length ? `tags  ${songTags.length}` : 'tags',
      key: tagsKey,
      tone: tones.song,
      active: songTags.length > 0,
      disabled: !track || (!local && !remote),
      stay: true,
      ...tagsLayout,
      choices: async () => {
        const values = await withDb(db => libraryTagValues(db, fields));
        const listed = tagList({
          pinned: buttons.tags,
          fields,
          values,
          extras,
          songTags,
          minSongs
        });
        return _.map(listed, tag =>
          tagEntry(
            tag,
            tag.pinned ? { key: pinnedKey(tag.pinned.key), label: tag.pinned.label } : {}
          )
        );
      }
    };

    // the grouping: the tag of a library song, or the grouping playlist a Spotify-only song is in
    const currentGrouping = local
      ? _.get(current, 'meta.grouping') || null
      : _.get(
          _.find(groupings, ({ id }) => inTarget.has(id)),
          'value',
          null
        );
    const sameGrouping = value => _.toLower(value) === _.toLower(currentGrouping || '');
    const groupingEntry = {
      icon: icons.grouping,
      label: 'genre',
      caption: currentGrouping || 'genre',
      key: groupingKey,
      tone: tones.song,
      active: Boolean(currentGrouping),
      disabled: !track || !groupingFrame || (!local && !remote),
      ...groupingLayout,
      // picked from the groupings used in the library; Spotify-only songs move between grouping playlists
      choices: async () =>
        _.map(await withDb(db => libraryGroupings(db, groupingFrame)), value => {
          const playlistId = groupingPlaylist(value);
          return {
            icon: icons.grouping,
            label: value,
            active: sameGrouping(value),
            disabled: sameGrouping(value) || (!local && !playlistId),
            run: async () => {
              if (local) {
                return writeLocal(context, { grouping: value });
              }
              const others = _.filter(groupings, ({ id }) => id !== playlistId && inTarget.has(id));
              for (const other of others) {
                await toggleRemote(track, other.id, false, `grouping=-${other.value}`);
              }
              return toggleRemote(track, playlistId, true, `grouping=${value}`);
            }
          };
        })
    };

    const detailsEntry = {
      icon: icons.details,
      label: 'details',
      key: detailsKey,
      tone: tones.song,
      disabled: !track,
      ...detailsLayout,
      choices: async () =>
        songInfo({
          track,
          file: local ? current.file : null,
          meta: local ? current.meta : null,
          playlists: await withDb(db =>
            playlistNames(db, track.trackId || _.get(current, 'meta.sp_track_id'))
          ),
          stat
        })
    };

    const ratingEntries = _.map(buttons.ratings, button => {
      const active = local
        ? Number(_.get(current, 'meta.rating')) === Number(button.value)
        : inTarget.has(button.playlistId);
      return {
        icon: button.icon,
        label: `rating ${button.label}`,
        caption: button.label,
        key: button.key,
        tone: tones.rating,
        active,
        // a rating is set, never cleared, from the menu: pressing the current one does nothing
        disabled: !track || active || (!local && !(remote && button.playlistId)),
        run: async () => {
          if (local) {
            return writeLocal(context, { rating: button.value });
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
      : likedLive === null
        ? inTarget.has(likedId)
        : likedLive;
    const ignored = inTarget.has(ignoreId);
    return [
      detailsEntry,
      groupingEntry,
      tagsEntry,
      ...ratingEntries,
      {
        icon: icons.like,
        label: liked ? 'unlike' : 'like',
        caption: local ? 'liked' : 'like',
        key: likeKey,
        tone: tones.like,
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
        tone: tones.ignore,
        active: ignored,
        disabled: !remote || !ignoreId,
        run: () => toggleRemote(track, ignoreId, !ignored, ignored ? 'unignore' : 'ignore')
      }
    ];
  };

  return { song, entries, buttons };
};

module.exports = {
  exactRating,
  extraTags,
  groupingTargets,
  hasValue,
  libraryGroupings,
  libraryTagValues,
  menuButtons,
  songActions,
  songDetails,
  songInfo,
  stars,
  tagFields,
  tagList
};
