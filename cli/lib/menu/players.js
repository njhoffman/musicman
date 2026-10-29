const _ = require('lodash');
const path = require('path');
const { execFile } = require('child_process');

const { connectMpd } = require('../clients/mpd.js');

// seconds seek moves and volume steps (percent), for both players
const seekStep = 10;
const volumeStep = 5;

// "key: value" lines of an MPD reply; only the first colon separates, titles can hold more
const parseMpdReply = text =>
  _.fromPairs(
    _.compact(
      _.map(String(text).split('\n'), line => {
        const at = line.indexOf(': ');
        return at > 0 ? [line.slice(0, at), line.slice(at + 2)] : null;
      })
    )
  );

// one MPD command on its own connection, resolving to the parsed reply
const mpdCommand = async (mpdConfig, command, connect = connectMpd) => {
  const client = await connect(mpdConfig);
  try {
    return await new Promise((resolve, reject) =>
      client.sendCommand(command, (err, msg) => (err ? reject(err) : resolve(parseMpdReply(msg))))
    );
  } finally {
    client.socket.destroy();
  }
};

const mpdStates = { play: 'playing', pause: 'paused', stop: 'stopped' };

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
      return {
        state: mpdStates[status.state] || null,
        volume: volume >= 0 ? volume : null,
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
    next: () => send('next'),
    prev: () => send('previous'),
    seek: seconds => send(`seekcur ${seconds >= 0 ? '+' : ''}${seconds}`),
    volume: async delta => {
      const volume = Number((await send('status')).volume);
      if (!(volume >= 0)) {
        throw new Error('MPD has no mixer, the volume cannot be changed');
      }
      return send(`setvol ${_.clamp(volume + delta, 0, 100)}`);
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
  'volume'
];

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
    next: () => playerctl('next'),
    prev: () => playerctl('previous'),
    seek: seconds => playerctl('position', `${Math.abs(seconds)}${seconds >= 0 ? '+' : '-'}`),
    volume: delta => playerctl('volume', `${Math.abs(delta) / 100}${delta >= 0 ? '+' : '-'}`)
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
  parseMpdReply,
  seekStep,
  spotifyPlayer,
  spotifyTrackId,
  volumeStep
};
