const _ = require('lodash');
const path = require('path');
const { execFile } = require('child_process');

const { parseMpdReply } = require('musicman-common/mpd/utils.js');
const { connectMpd } = require('../clients/mpd.js');

// seconds seek moves and volume steps (percent), for both players
const seekStep = 30;
const volumeStep = 5;

// one MPD command on its own connection, resolving to the parsed reply (the raw text with raw)
const mpdCommand = async (mpdConfig, command, connect = connectMpd, { raw = false } = {}) => {
  const client = await connect(mpdConfig);
  try {
    return await new Promise((resolve, reject) =>
      client.sendCommand(command, (err, msg) =>
        err ? reject(err) : resolve(raw ? msg : parseMpdReply(msg))
      )
    );
  } finally {
    client.socket.destroy();
  }
};

const mpdStates = { play: 'playing', pause: 'paused', stop: 'stopped' };

// the songs of an MPD playlistinfo reply, one record per file: line
const parseMpdSongs = text =>
  _.map(
    _.filter(String(text).split(/\n(?=file: )/), chunk => chunk.startsWith('file: ')),
    parseMpdReply
  );

// an MPD song as a queue entry: its place (1-based), file, title, artist, and length
const queueEntry = (config, song) => ({
  position: Number(song.Pos) + 1,
  file: path.join(config.mpd.baseDirectory, song.file),
  title: song.Title || path.basename(song.file, path.extname(song.file)),
  artist: song.Artist || '',
  duration: Number(song.duration || song.Time) || 0
});

// MPD's repeat and single as off, playlist, or track; null when the status leaves them out
const mpdRepeat = ({ repeat, single }) => {
  if (repeat === undefined) {
    return null;
  }
  if (repeat !== '1') {
    return 'off';
  }
  return single === '1' ? 'track' : 'playlist';
};

/**
 * MPD through its protocol. state() resolves to { state, track, volume } with the track's file (absolute,
 * under mpd.baseDirectory), or to { state: null } when MPD cannot be reached.
 */
const mpdPlayer = (config, { connect = connectMpd } = {}) => {
  const send = command => mpdCommand(config.mpd, command, connect);
  const player = {
    source: 'mpd',
    name: 'MPD',
    state: async () => {
      let status;
      let song;
      try {
        status = await send('status');
        song = status.state === 'stop' ? {} : await send('currentsong');
      } catch (err) {
        return { state: null, error: err.message };
      }
      const volume = Number(status.volume);
      const position = Number(status.song);
      return {
        state: mpdStates[status.state] || null,
        volume: volume >= 0 ? volume : null,
        // MPD's random and repeat (single makes repeat play one track), reported like Spotify's
        shuffle: status.random === undefined ? null : status.random === '1',
        repeat: mpdRepeat(status),
        // the place of the song in the queue, 1-based
        queue:
          status.playlistlength === undefined
            ? null
            : {
                position: Number.isNaN(position) ? null : position + 1,
                length: Number(status.playlistlength)
              },
        track: song.file
          ? {
              file: path.join(config.mpd.baseDirectory, song.file),
              title: song.Title || path.basename(song.file, path.extname(song.file)),
              artist: song.Artist || '',
              album: song.Album || '',
              position: Number(status.elapsed) || 0,
              duration: Number(status.duration || song.duration) || 0
            }
          : null
      };
    },
    toggle: async () => {
      const { state } = await send('status');
      return send(state === 'play' ? 'pause 1' : 'play');
    },
    play: () => send('play'),
    pause: () => send('pause 1'),
    stop: () => send('stop'),
    next: () => send('next'),
    prev: () => send('previous'),
    seek: seconds => send(`seekcur ${seconds >= 0 ? '+' : ''}${seconds}`),
    // to a position in seconds from the start of the song
    seekTo: seconds => send(`seekcur ${Math.max(0, seconds)}`),
    setVolume: async percent => {
      const volume = Number((await send('status')).volume);
      if (!(volume >= 0)) {
        throw new Error('MPD has no mixer, the volume cannot be changed');
      }
      return send(`setvol ${_.clamp(Math.round(percent), 0, 100)}`);
    },
    // the next count songs of the queue after the one playing (from the start when stopped)
    queue: async count => {
      const status = await send('status');
      const current = Number.isNaN(Number(status.song)) ? -1 : Number(status.song);
      const start = current + 1;
      const text = await mpdCommand(config.mpd, `playlistinfo ${start}:${start + count}`, connect, {
        raw: true
      });
      return {
        length: Number(status.playlistlength) || 0,
        current: current >= 0 ? current + 1 : null,
        tracks: _.map(parseMpdSongs(text), song => queueEntry(config, song))
      };
    },
    volume: async delta => {
      const volume = Number((await send('status')).volume);
      if (!(volume >= 0)) {
        throw new Error('MPD has no mixer, the volume cannot be changed');
      }
      return send(`setvol ${_.clamp(volume + delta, 0, 100)}`);
    },
    // random on, off, or toggle
    shuffle: async mode => {
      if (!['on', 'off', 'toggle'].includes(mode)) {
        throw new Error(`Unknown shuffle mode '${mode}', use on, off, or toggle`);
      }
      const on = mode === 'toggle' ? (await send('status')).random !== '1' : mode === 'on';
      return send(`random ${on ? 1 : 0}`);
    },
    // repeat off, playlist (the queue), or track (repeat with single)
    repeat: async mode => {
      const settings = { off: [0, 0], playlist: [1, 0], track: [1, 1] }[mode];
      if (!settings) {
        throw new Error(`Unknown repeat mode '${mode}', use ${repeatCycle.join(', ')}`);
      }
      await send(`repeat ${settings[0]}`);
      return send(`single ${settings[1]}`);
    }
  };
  return player;
};

// playerctl output fields, tab separated
const spotifyFields = [
  'status',
  'xesam:url',
  'xesam:title',
  'xesam:artist',
  'xesam:album',
  'mpris:artUrl',
  'mpris:length',
  'position',
  'volume',
  'shuffle',
  'loop'
];

// repeat modes by their MPRIS LoopStatus, and the order the repeat button cycles through them
const repeatModes = { None: 'off', Playlist: 'playlist', Track: 'track' };
const repeatCycle = ['off', 'playlist', 'track'];
const loopStatus = _.invert(repeatModes);

// the repeat mode after mode, off again after track
const nextRepeat = mode => repeatCycle[(repeatCycle.indexOf(mode) + 1) % repeatCycle.length];

// MPRIS shuffle as true or false, null when the player does not report it
const parseShuffle = value => {
  const text = _.toLower(value);
  if (['true', 'on'].includes(text)) {
    return true;
  }
  return ['false', 'off'].includes(text) ? false : null;
};

const runFile = (bin, args) =>
  new Promise((resolve, reject) =>
    execFile(bin, args, { timeout: 5000 }, (err, stdout, stderr) =>
      err
        ? reject(new Error(`${bin} ${args.join(' ')}: ${stderr.trim() || err.message}`))
        : resolve(stdout)
    )
  );

// the track id in a Spotify URL or URI, e.g. https://open.spotify.com/track/65iXgVBjiF7oOORNWo0hRV
const spotifyTrackId = text => {
  const match = /track[/:]([A-Za-z0-9]{22})/.exec(text || '');
  return match ? match[1] : null;
};

/**
 * The Spotify desktop app through MPRIS (playerctl). state() resolves to { state, track, volume } with
 * the track's Spotify id and cover URL, or to { state: null } when Spotify is not running.
 */
const spotifyPlayer = ({ run = runFile } = {}) => {
  const playerctl = (...args) => run('playerctl', ['-p', 'spotify', ...args]);
  return {
    source: 'spotify',
    name: 'Spotify',
    state: async () => {
      let output;
      try {
        output = await playerctl(
          'metadata',
          '--format',
          _.map(spotifyFields, field => `{{${field}}}`).join('\t')
        );
      } catch (err) {
        return { state: null, error: err.message };
      }
      const values = _.zipObject(spotifyFields, output.replace(/\n$/, '').split('\t'));
      const trackId = spotifyTrackId(values['xesam:url']);
      const volume = parseFloat(values.volume);
      return {
        state: _.toLower(values.status) || null,
        volume: _.isNaN(volume) ? null : Math.round(volume * 100),
        shuffle: parseShuffle(values.shuffle),
        repeat: repeatModes[values.loop] || null,
        track: trackId
          ? {
              trackId,
              title: values['xesam:title'],
              artist: values['xesam:artist'],
              album: values['xesam:album'],
              artUrl: values['mpris:artUrl'] || null,
              // MPRIS times are in microseconds
              position: Number(values.position) / 1e6 || 0,
              duration: Number(values['mpris:length']) / 1e6 || 0
            }
          : null
      };
    },
    toggle: () => playerctl('play-pause'),
    play: () => playerctl('play'),
    pause: () => playerctl('pause'),
    stop: () => playerctl('stop'),
    next: () => playerctl('next'),
    prev: () => playerctl('previous'),
    seek: seconds => playerctl('position', `${Math.abs(seconds)}${seconds >= 0 ? '+' : '-'}`),
    // to a position in seconds from the start of the track
    seekTo: seconds => playerctl('position', `${Math.max(0, seconds)}`),
    volume: delta => playerctl('volume', `${Math.abs(delta) / 100}${delta >= 0 ? '+' : '-'}`),
    setVolume: percent => playerctl('volume', `${_.clamp(Math.round(percent), 0, 100) / 100}`),
    // shuffle on, off, or toggle
    shuffle: mode => {
      const value = { on: 'On', off: 'Off', toggle: 'Toggle' }[mode];
      if (!value) {
        throw new Error(`Unknown shuffle mode '${mode}', use on, off, or toggle`);
      }
      return playerctl('shuffle', value);
    },
    // repeat off, playlist (the whole context), or track
    repeat: mode => {
      if (!loopStatus[mode]) {
        throw new Error(`Unknown repeat mode '${mode}', use ${repeatCycle.join(', ')}`);
      }
      return playerctl('loop', loopStatus[mode]);
    },
    // plays a Spotify URI (spotify:playlist:...) in the desktop app
    open: spotifyUri => playerctl('open', spotifyUri)
  };
};

/**
 * The player the menu controls and the states of all of them: the one playing (Spotify when both
 * are), else a paused one (preferred when both are paused, e.g. the one used last), else null.
 * Players that are not running have state null.
 */
const choosePlayer = async (players, { preferred } = {}) => {
  const states = await Promise.all(_.map(players, player => player.state()));
  const withState = _.map(players, (player, i) => ({ player, status: states[i] }));
  const ordered = _.sortBy(withState, ({ player }) => (player.source === preferred ? 0 : 1));
  const playing = _.filter(withState, ({ status }) => status.state === 'playing');
  const pick =
    _.find(playing, ({ player }) => player.source === 'spotify') ||
    playing[0] ||
    _.find(ordered, ({ status }) => status.state === 'paused') ||
    null;
  return { active: pick, all: withState };
};

module.exports = {
  choosePlayer,
  mpdPlayer,
  parseMpdSongs,
  nextRepeat,
  repeatCycle,
  seekStep,
  spotifyPlayer,
  spotifyTrackId,
  volumeStep
};
