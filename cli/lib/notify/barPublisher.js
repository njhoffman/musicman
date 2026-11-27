const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { barSettings, renderBar } = require('../status/bar.js');
const { choosePlayer } = require('../player/players.js');
const logger = require('../utils/logger.js');
const { trackKey } = require('./notification.js');
const { confirmedLikedFile, isHearted, likeFacts } = require('./liked.js');

// how often the time left is redrawn from the last known position, in milliseconds
const tickMs = 1000;
// how often the players and the file's tags are read again: catches what sends no event (a seek in
// Spotify, Spotify closing) and a rating set while the song plays
const resyncMs = 5000;
// how often Spotify is asked whether the playing track is in Liked Songs
const likedMs = 30000;

// $XDG_RUNTIME_DIR/musicman/now-playing, /run/user/<uid> without XDG_RUNTIME_DIR
const barFile = (env = process.env) =>
  path.join(env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`, 'musicman', 'now-playing');

/**
 * The file bars read, replaced atomically: the active player on line 1 and the polybar line on line 2,
 * both empty when nothing plays. See docs/09-contract.md.
 */
const barWriter = file => ({
  write: (source, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${source}\n${text}\n`);
    fs.renameSync(temporary, file);
  },
  remove: () => fs.rmSync(file, { force: true })
});

// the modification time of a file, or null when it is gone
const fileMtime = file => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/**
 * Keeps the bar file on what plays: refresh() reads the players (and the song on a new track or changed
 * file), tick() redraws the time left. The heart starts from the cached Liked Songs and follows Spotify
 * while a track plays; when Spotify cannot be asked the last answer stays. A track without its own Spotify
 * id (a local file, or MPD's) also has the heart when it is among the local likes (localLikes), or while
 * those are unknown, when its file was confirmed in Liked Songs (sync --export --confirm).
 * Dependencies: players { mpd, spotify }, openDb() the library database or null, readSong(file) its tags,
 * liked(trackId) Spotify's answer, likes (optional) localLikes, writer { write, remove }, and for tests
 * confirmedLiked(file), now(), and mtime(file).
 */
const createBarPublisher = ({
  config,
  players,
  openDb,
  readSong,
  liked,
  likes = null,
  writer,
  confirmedLiked = confirmedLikedFile(config),
  now = Date.now,
  mtime = fileMtime
}) => {
  const list = [players.mpd, players.spotify];
  let current = null;
  let song = null;
  let published = null;
  let writeFailed = false;
  let likedAt = 0;
  let asking = false;
  let queue = Promise.resolve();
  let queued = false;

  // the heart: Spotify's answer for the track's id, or for a track without its own id the local likes
  const hearted = () => isHearted(song, likes);

  const publish = () => {
    const position = current
      ? current.position + (current.state === 'playing' ? (now() - current.sampledAt) / 1000 : 0)
      : 0;
    const view =
      current && song
        ? {
            ...current,
            inLibrary: song.inLibrary,
            rating: song.rating,
            liked: hearted(),
            remaining: current.duration ? current.duration - position : null
          }
        : null;
    // line 1 is the player bars send clicks to: the MPRIS name (spotify, soloist, spotifyd) or the source (mpd)
    const output = `${view ? view.mpris || view.source : ''}\n${renderBar(view, config)}`;
    if (output === published) {
      return;
    }
    const [source, text] = output.split('\n');
    try {
      writer.write(source, text);
      published = output;
      writeFailed = false;
    } catch (err) {
      // written again each second while something plays, so said once
      if (!writeFailed) {
        logger.error(`Could not write the bar file: ${err.message}`);
      }
      writeFailed = true;
    }
  };

  // the file, tags, Spotify id, and cached heart of a track; without a database, only what MPD knows
  const loadSong = async active => {
    const { track } = active.status;
    let facts = likeFacts(null, config, { player: active.player, track }, { confirmedLiked });
    try {
      const db = openDb();
      if (db) {
        try {
          facts = likeFacts(db, config, { player: active.player, track }, { confirmedLiked });
        } finally {
          db.close();
        }
      }
    } catch (err) {
      logger.warn(`Bar: no library lookup for ${track.title}: ${err.message}`);
    }
    const { file } = facts;
    let meta = null;
    if (file) {
      meta = await Promise.resolve(readSong(file)).catch(err => {
        logger.warn(`Bar: could not read ${file}: ${err.message}`);
        return null;
      });
    }
    return {
      ...facts,
      mtime: file ? mtime(file) : null,
      inLibrary: Boolean(meta),
      rating: meta ? meta.rating : null
    };
  };

  // asks Spotify about the heart, at most once at a time; the answer of an old track is dropped
  const askLiked = key => {
    if (asking || !song || now() - likedAt < likedMs) {
      return;
    }
    const { trackId, tags } = song;
    const checkLikes = likes && tags;
    if (!trackId && !checkLikes) {
      return;
    }
    asking = true;
    likedAt = now();
    const askCatalog = trackId
      ? Promise.resolve()
          .then(() => liked(trackId))
          .then(answer => {
            if (_.isBoolean(answer) && current && current.key === key) {
              song = { ...song, catalogLiked: answer };
              publish();
            }
          })
          .catch(err => logger.debug(`Bar: no Liked Songs answer: ${err.message}`))
      : null;
    const askLikes = checkLikes
      ? likes.refresh().then(changed => {
          if (changed && current) {
            publish();
          }
        })
      : null;
    Promise.all([askCatalog, askLikes]).finally(() => {
      asking = false;
    });
  };

  const read = async () => {
    const { active } = await choosePlayer(list);
    const status = active ? active.status : null;
    if (!status || !status.track || !['playing', 'paused'].includes(status.state)) {
      current = null;
      song = null;
      publish();
      return;
    }
    const key = trackKey(active.player.source, status.track);
    if (!current || current.key !== key) {
      song = await loadSong(active);
      likedAt = 0;
    } else if (song.file && mtime(song.file) !== song.mtime) {
      // rated, or moved by beets; a file not found yet keeps what it showed until the track ends
      const fresh = await loadSong(active);
      if (fresh.inLibrary) {
        song = { ...fresh, catalogLiked: song.catalogLiked };
      }
    }
    current = {
      key,
      source: active.player.source,
      mpris: status.mpris || null,
      state: status.state,
      title: status.track.title,
      artist: status.track.artist,
      position: status.track.position || 0,
      duration: status.track.duration || 0,
      sampledAt: now()
    };
    publish();
    if (status.state === 'playing') {
      askLiked(key);
    }
  };

  return {
    // reads one at a time, and a burst of events waiting for one read causes only one more
    refresh: () => {
      if (queued) {
        return queue;
      }
      queued = true;
      queue = queue
        .then(() => {
          queued = false;
          return read();
        })
        .catch(err => logger.error(`Bar: could not read the players: ${err.message}`));
      return queue;
    },
    tick: () => {
      if (current && current.state === 'playing') {
        publish();
      }
    }
  };
};

/**
 * Publishes what plays until stop(), which removes the file so bars go empty. Returns { refresh, stop },
 * or null when config.bar.enabled is false.
 */
const startBar = (config, { players, openDb, readSong, liked, likes = null, file = barFile() }) => {
  if (!barSettings(config).enabled) {
    return null;
  }
  const writer = barWriter(file);
  const publisher = createBarPublisher({ config, players, openDb, readSong, liked, likes, writer });
  const timers = [setInterval(publisher.tick, tickMs), setInterval(publisher.refresh, resyncMs)];
  publisher.refresh();
  return {
    refresh: publisher.refresh,
    stop: () => {
      _.each(timers, clearInterval);
      try {
        writer.remove();
      } catch (err) {
        logger.warn(`Could not remove the bar file: ${err.message}`);
      }
    }
  };
};

module.exports = { barFile, barWriter, createBarPublisher, startBar };
