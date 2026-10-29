const _ = require('lodash');
const { execFile } = require('child_process');

const { coverFor } = require('./cover.js');
const { choosePlayer, seekStep, volumeStep } = require('./players.js');
const { escapeMarkup } = require('./rofi.js');

// Nerd Font glyphs (Font Awesome code points); the star is the plain Unicode one
const icons = {
  spotify: '',
  mpd: '',
  prev: '',
  play: '',
  pause: '',
  next: '',
  back: '',
  forward: '',
  volumeDown: '',
  volumeUp: '',
  switch: '',
  tag: '',
  rating: '★',
  like: '',
  ignore: ''
};

// accent colors per source, so which player the menu controls shows at a glance
const accents = { spotify: '#1db954', mpd: '#e5c07b' };

// keys every menu answers besides its buttons': q closes the menu, Tab switches player
const quitKey = 'q';
const switchKey = 'Tab';

// time for a player to report the next song after a skip, before the menu is drawn again
const settleMs = 400;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const clock = seconds => {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
};

// errors go to a notification, opened from a keybinding there is no terminal to read them in
const notifyError = (message, { exec = execFile } = {}) =>
  new Promise(resolve =>
    exec('notify-send', ['-u', 'critical', '-a', 'musicman', 'musicman menu', message], () =>
      resolve()
    )
  );

/**
 * A rofi menu for the song playing in MPD or Spotify: playback controls for either player, with the
 * same layout for both, and the source shown in the title, the accent color, and the status. It stays
 * open after each action until q or Escape. Tab switches to the other player when both are running.
 * songActions (optional) adds buttons that act on the song: { entries(context) } where context is
 * { player, status, track } and each entry has run().
 */
class Menu {
  constructor({
    players,
    view,
    songActions = null,
    cover = coverFor,
    notify = notifyError,
    settle = settleMs
  }) {
    this.players = players;
    this.view = view;
    this.songActions = songActions;
    this.cover = cover;
    this.notify = notify;
    this.settle = settle;
    this.forced = null;
  }

  // the player to control: one picked with Tab while it still runs, else the one playing or paused
  async current() {
    const { active, all } = await choosePlayer(this.players, { preferred: this.forced });
    const forced = _.find(
      all,
      ({ player, status }) => player.source === this.forced && status.state
    );
    const running = _.filter(all, ({ status }) => status.state);
    return { active: forced || active || running[0] || null, running };
  }

  async open() {
    for (;;) {
      let result;
      try {
        result = await this.mainMenu();
      } catch (err) {
        await this.notify(err.message);
        throw err;
      }
      if (result.quit) {
        return;
      }
    }
  }

  // runs a picked action; an error is announced and the menu stays open
  async attempt(action) {
    try {
      return (await action()) || {};
    } catch (err) {
      await this.notify(err.message);
      return {};
    }
  }

  // title, details (Pango markup), status lines, accent and cover of the playing song
  async describe({ player, status }, song = {}) {
    const { track } = status;
    const badge = `${icons[player.source]}  ${player.name}`;
    if (!track) {
      return {
        title: badge,
        message: escapeMarkup(`${player.name}: nothing playing`),
        status: [`<b>${escapeMarkup(player.name)}</b>`, escapeMarkup(status.state || '')],
        accent: accents[player.source]
      };
    }
    const progress = `${status.state === 'playing' ? '▶' : '⏸'}  ${clock(track.position)} / ${clock(
      track.duration
    )}`;
    const details = [
      `<b>${escapeMarkup(track.title)}</b>`,
      escapeMarkup(_.compact([track.artist, track.album]).join('  ·  ')),
      escapeMarkup(progress),
      ...(song.details || [])
    ];
    return {
      title: `${badge}  ·  ${track.title}`,
      message: details.join('\n'),
      status: [
        `<b>${escapeMarkup(player.name)}</b>`,
        escapeMarkup(status.state),
        ...(status.volume === null || status.volume === undefined
          ? []
          : [`vol  <b>${status.volume}%</b>`]),
        ...(song.status || [])
      ],
      accent: accents[player.source],
      cover: await this.cover(track, { file: song.file })
    };
  }

  // the playback buttons, the same for MPD and Spotify; settle waits for the player to change songs
  controls({ player, status }, running) {
    const playing = status.state === 'playing';
    const other = _.find(running, ({ player: candidate }) => candidate !== player);
    const control = (icon, label, key, run, extra = {}) => ({ icon, label, key, run, ...extra });
    return [
      control(icons.prev, 'prev', 'p', async () => {
        await player.prev();
        await wait(this.settle);
      }),
      control(playing ? icons.pause : icons.play, playing ? 'pause' : 'play', 't', async () => {
        await player.toggle();
        await wait(this.settle);
      }),
      control(icons.next, 'next', 'n', async () => {
        await player.next();
        await wait(this.settle);
      }),
      control(icons.back, `-${seekStep}s`, 'h', () => player.seek(-seekStep), {
        disabled: !status.track
      }),
      control(icons.forward, `+${seekStep}s`, 'l', () => player.seek(seekStep), {
        disabled: !status.track
      }),
      control(icons.volumeDown, 'vol -', 'minus', () => player.volume(-volumeStep), {
        disabled: status.volume === null
      }),
      control(icons.volumeUp, 'vol +', 'equal', () => player.volume(volumeStep), {
        disabled: status.volume === null
      }),
      control(
        icons.switch,
        other ? other.player.name : 'switch',
        switchKey,
        () => {
          this.forced = other.player.source;
        },
        { disabled: !other }
      )
    ];
  }

  async mainMenu() {
    const { active, running } = await this.current();
    if (!active) {
      throw new Error('Neither MPD nor Spotify is running');
    }
    const context = { player: active.player, status: active.status, track: active.status.track };
    const song = this.songActions ? await this.songActions.song(context) : {};
    const item = await this.describe(active, song);
    const controls = this.controls(active, running);
    const actions = this.songActions ? await this.songActions.entries({ ...context, song }) : [];
    const entries = [...controls, ...actions];
    const picked = await this.view({
      ...item,
      entries,
      keys: [quitKey],
      columns: controls.length
    });
    if (picked === null || picked.key === quitKey) {
      return { quit: true };
    }
    const entry = picked.key ? _.find(entries, { key: picked.key }) : entries[picked];
    if (!entry || entry.disabled) {
      return {};
    }
    return this.attempt(entry.run);
  }
}

module.exports = { Menu, accents, clock, icons, notifyError, quitKey, switchKey };
