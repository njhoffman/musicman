const _ = require('lodash');
const { execFile } = require('child_process');

const { coverFor } = require('./cover.js');
const { choosePlayer, nextRepeat, seekStep, volumeStep } = require('../player/players.js');
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
  tag: '',
  tags: '\uf02c',
  details: '\uf05a',
  context: '\uf041',
  mood: '\uf118',
  picks: '\uf004',
  rating: '★',
  like: '',
  ignore: '',
  shuffle: '\uf074',
  repeat: '\uf01e',
  reshuffle: '\uf021',
  grouping: '\uf07b'
};

// keys of the shuffle, repeat, and reshuffle buttons
const modeKeys = { shuffle: 'u', repeat: 'r', reshuffle: 'o' };

// accent colors per source, so which player the menu controls shows at a glance
const accents = { spotify: '#1db954', mpd: '#e5c07b' };

// icon colors per kind of button: playback takes the source's accent, the rest a color of their own
const tones = {
  mode: '#61afef',
  song: '#c678dd',
  rating: '#f5c542',
  like: '#e06c75',
  ignore: '#7f8796'
};

// colors of the song's tags in the details: a foreground and a dark background per field
const chipColors = {
  context: ['#61afef', '#1f3347'],
  mood: ['#c678dd', '#33264a'],
  picks: ['#e06c75', '#45262b']
};
const defaultChip = ['#98c379', '#28351f'];

// the key the main menu answers besides its buttons': q closes it (submenus filter as you type, so
// Escape goes back there)
const quitKey = 'q';

// characters of the progress bar in the details
const progressWidth = 28;

// time for a player to report the next song after a skip, before the menu is drawn again
const settleMs = 400;

// buttons per row in a menu of choices, unless the entry sets its own
const choiceColumns = 4;

// rows of buttons on the main menu
const mainRows = 2;

// how often the open menu checks whether the song changed, to draw it again
const followMs = 1000;

// what identifies the song a menu shows: its player and track
const trackKey = active =>
  active && active.status.track
    ? `${active.player.source}:${active.status.track.trackId || active.status.track.file}`
    : null;

// a rating as stars, a half star for .5
const stars = rating => {
  const value = Number(rating) || 0;
  return `${'★'.repeat(Math.floor(value))}${value % 1 ? '½' : ''}`;
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const clock = seconds => {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
};

// errors go to a notification, opened from a keybinding there is no terminal to read them in
// a bar of how far the song has played, the played part in accent
const progressBar = (position, duration, accent, width = progressWidth) => {
  const played = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const filled = Math.round(played * (width - 1));
  return `<span foreground="${accent}">${'━'.repeat(filled)}●</span><span alpha="35%">${'─'.repeat(
    width - 1 - filled
  )}</span>`;
};

const notifyError = (message, { exec = execFile } = {}) =>
  new Promise(resolve =>
    exec('notify-send', ['-u', 'critical', '-a', 'musicman', 'musicman menu', message], () =>
      resolve()
    )
  );

/**
 * A rofi menu for the song playing in MPD or Spotify (Spotify when both play): playback controls for
 * either player, with the same layout for both, and the source shown in the title, the accent color,
 * and the status. It opens with next highlighted and stays open after each action until q or Escape.
 * songActions (optional) adds buttons that act on the song: { song(context), entries(context) } where
 * context is { player, status, track } and each entry has run().
 * Players with shuffle and repeat (Spotify) get buttons for them; reshuffle (optional) is
 * { source(track): name of the source it would shuffle, or null, run() }. An entry with choices()
 * opens a second menu of them (see choose).
 */
class Menu {
  constructor({
    players,
    view,
    songActions = null,
    reshuffle = null,
    cover = coverFor,
    notify = notifyError,
    settle = settleMs,
    follow = followMs
  }) {
    this.players = players;
    this.view = view;
    this.songActions = songActions;
    this.reshuffle = reshuffle;
    this.cover = cover;
    this.notify = notify;
    this.settle = settle;
    this.follow = follow;
  }

  // the player to control: the one playing, else a paused one, else any running one
  async current() {
    const { active, all } = await choosePlayer(this.players);
    return { active: active || _.find(all, ({ status }) => status.state) || null };
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
    const accent = accents[player.source];
    const progress = `${status.state === 'playing' ? '▶' : '⏸'}  ${clock(
      track.position
    )}  ${progressBar(track.position, track.duration, accent)}  ${clock(track.duration)}`;
    const details = [
      `<span font_size="large"><b>${escapeMarkup(track.title)}</b></span>`,
      _.compact([
        track.artist && `<b>${escapeMarkup(track.artist)}</b>`,
        track.album && `<span alpha="65%">${escapeMarkup(track.album)}</span>`
      ]).join('  ·  '),
      progress,
      ...(song.details || [])
    ];
    return {
      title: badge,
      message: details.join('\n'),
      status: [
        `<b>${escapeMarkup(player.name)}</b>`,
        escapeMarkup(status.state),
        ...(status.volume === null || status.volume === undefined
          ? []
          : [`vol  <b>${status.volume}%</b>`]),
        ...(song.status || [])
      ],
      accent,
      cover: await this.cover(track, { file: song.file })
    };
  }

  // the playback buttons, the same for MPD and Spotify; settle waits for the player to change songs
  controls({ player, status }) {
    const playing = status.state === 'playing';
    const tone = accents[player.source];
    const control = (icon, label, key, run, extra = {}) => ({
      icon,
      label,
      key,
      run,
      tone,
      ...extra
    });
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
      })
    ];
  }

  // shuffle, repeat, and reshuffle; drawn for every player so the layout stays the same, disabled
  // where the player has no such mode (MPD)
  async modes({ player, status }) {
    const canShuffle = Boolean(player.shuffle) && _.isBoolean(status.shuffle);
    const canRepeat = Boolean(player.repeat) && Boolean(status.repeat);
    const source =
      this.reshuffle && player.source === 'spotify' && status.track
        ? await this.reshuffle.source(status.track)
        : null;
    return [
      {
        icon: icons.shuffle,
        label: canShuffle ? `shuffle ${status.shuffle ? 'on' : 'off'}` : 'shuffle',
        key: modeKeys.shuffle,
        tone: tones.mode,
        active: canShuffle && status.shuffle,
        disabled: !canShuffle,
        run: () => player.shuffle('toggle')
      },
      {
        icon: icons.repeat,
        label: canRepeat ? `repeat ${status.repeat}` : 'repeat',
        key: modeKeys.repeat,
        tone: tones.mode,
        active: canRepeat && status.repeat !== 'off',
        disabled: !canRepeat,
        run: () => player.repeat(nextRepeat(status.repeat))
      },
      {
        icon: icons.reshuffle,
        label: 'reshuffle',
        caption: source ? `reshuffle ${source}` : 'reshuffle',
        key: modeKeys.reshuffle,
        tone: tones.mode,
        disabled: !source,
        run: async () => {
          await this.reshuffle.run();
          await wait(this.settle);
        }
      }
    ];
  }

  /**
   * Shows menu and resolves to the pick; while it is open, checks every follow ms whether the song
   * changed (another track, or another player taking over) and then closes it to be drawn again.
   */
  async show(menu, shownKey) {
    if (!this.follow) {
      return this.view(menu);
    }
    const controller = new AbortController();
    let timer;
    const check = async () => {
      try {
        const { active } = await this.current();
        if (trackKey(active) !== shownKey) {
          controller.abort();
          return;
        }
      } catch {
        // a player that cannot be asked right now changes nothing
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(check, this.follow);
      }
    };
    timer = setTimeout(check, this.follow);
    try {
      return await this.view({ ...menu, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  /**
   * A second menu for an entry with choices() (genre, tags, details): the same song panel with the
   * choices as buttons, drawn as plain text so typing filters them; Escape goes back to the main menu.
   * The entry sets columns, height (lines of text per button), maxLines (rows shown, scrolled past),
   * align ('left' for lines of text) and
   * stay: after a pick the menu is drawn again with the song read anew (refresh() resolves to the fresh
   * { entry, item }), so several tags can be toggled in a row. A choice without run() only goes back.
   */
  async choose(entry, item, refresh) {
    let current = entry;
    let panel = item;
    for (;;) {
      const choices = await current.choices();
      const picked = await this.view({
        ...panel,
        title: `${panel.title}  ·  ${current.label}`,
        entries: choices,
        keys: [],
        plain: true,
        columns: current.columns || choiceColumns,
        height: current.height,
        maxLines: current.maxLines,
        align: current.align
      });
      if (picked === null || picked.redraw) {
        return {};
      }
      const choice = picked.key ? _.find(choices, { key: picked.key }) : choices[picked];
      if (!choice || !choice.run || (choice.disabled && !current.stay)) {
        return {};
      }
      const result = choice.disabled ? {} : await this.attempt(choice.run);
      if (!current.stay) {
        return result;
      }
      ({ entry: current, item: panel } = await refresh());
      if (!current || !current.choices) {
        return result;
      }
    }
  }

  async mainMenu() {
    const { active } = await this.current();
    if (!active) {
      throw new Error('Neither MPD nor Spotify is running');
    }
    const context = { player: active.player, status: active.status, track: active.status.track };
    // the song panel and its buttons, built again after a change made from a submenu
    const build = async () => {
      const song = this.songActions ? await this.songActions.song(context) : {};
      const item = await this.describe(active, song);
      const actions = this.songActions ? await this.songActions.entries({ ...context, song }) : [];
      return { item, actions };
    };
    const { item, actions } = await build();
    const controls = this.controls(active);
    const modes = await this.modes(active);
    const entries = [...controls, ...modes, ...actions];
    const picked = await this.show(
      {
        ...item,
        entries,
        keys: [quitKey],
        columns: Math.ceil(entries.length / mainRows),
        selected: _.findIndex(entries, { label: 'next' })
      },
      trackKey(active)
    );
    if (picked === null || picked.key === quitKey) {
      return { quit: true };
    }
    if (picked.redraw) {
      return {};
    }
    const entry = picked.key ? _.find(entries, { key: picked.key }) : entries[picked];
    if (!entry || entry.disabled) {
      return {};
    }
    if (entry.choices) {
      const refresh = async () => {
        const fresh = await build();
        return { entry: _.find(fresh.actions, { key: entry.key }) || null, item: fresh.item };
      };
      return this.attempt(() => this.choose(entry, item, refresh));
    }
    return this.attempt(entry.run);
  }
}

module.exports = {
  Menu,
  accents,
  chipColors,
  clock,
  defaultChip,
  icons,
  modeKeys,
  notifyError,
  progressBar,
  quitKey,
  stars,
  tones
};
