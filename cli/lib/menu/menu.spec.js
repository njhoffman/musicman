const { expect } = require('chai');

const { Menu, clock } = require('./menu.js');

describe('Menu', () => {
  const track = { title: 'Song', artist: 'Artist', album: 'Album', position: 61, duration: 200 };
  // a player with a fixed state that records the controls used
  const fakePlayer = (source, state, extra = {}) => {
    const calls = [];
    const record =
      name =>
      async (...args) => {
        calls.push([name, ...args]);
      };
    return {
      calls,
      source,
      name: source === 'mpd' ? 'MPD' : 'Spotify',
      state: async () => ({ state, volume: 50, track, ...extra }),
      toggle: record('toggle'),
      next: record('next'),
      prev: record('prev'),
      seek: record('seek'),
      volume: record('volume')
    };
  };
  // a view answering each menu from picks in turn, then dismissing it; menus are kept
  const fakeView = picks => {
    const menus = [];
    const view = async menu => {
      menus.push(menu);
      return picks.length ? picks.shift() : null;
    };
    return { menus, view };
  };
  const menuWith = ({ players, view, ...rest }) =>
    new Menu({
      players,
      view,
      cover: async () => '/cover.jpg',
      settle: 0,
      notify: async () => {},
      ...rest
    });

  it('should show the source, the song and the same controls for MPD and Spotify', async () => {
    const layouts = [];
    for (const source of ['mpd', 'spotify']) {
      const { menus, view } = fakeView([]);
      await menuWith({ players: [fakePlayer(source, 'playing')], view }).open();
      const [menu] = menus;
      expect(menu.title).to.equal(`${source === 'mpd' ? '  MPD' : '  Spotify'}  ·  Song`);
      expect(menu.message).to.equal('<b>Song</b>\nArtist  ·  Album\n▶  1:01 / 3:20');
      expect(menu.status.slice(0, 3)).to.deep.equal([
        `<b>${source === 'mpd' ? 'MPD' : 'Spotify'}</b>`,
        'playing',
        'vol  <b>50%</b>'
      ]);
      expect(menu.cover).to.equal('/cover.jpg');
      layouts.push(menu.entries.map(({ key, label }) => [key, label]));
    }
    expect(layouts[0]).to.deep.equal(layouts[1]);
    expect(layouts[0].map(([key]) => key)).to.deep.equal([
      'p',
      't',
      'n',
      'h',
      'l',
      'minus',
      'equal',
      'Tab',
      'u',
      'r',
      'o'
    ]);
  });

  describe('shuffle, repeat, and reshuffle', () => {
    // a Spotify player with shuffle and repeat, recording the modes set
    const modePlayer = (shuffle, repeat) => {
      const player = fakePlayer('spotify', 'playing', { shuffle, repeat });
      player.shuffle = async mode => player.calls.push(['shuffle', mode]);
      player.repeat = async mode => player.calls.push(['repeat', mode]);
      return player;
    };
    const modesOf = menu => menu.entries.filter(({ key }) => ['u', 'r', 'o'].includes(key));

    it('should show the shuffle and repeat state and highlight modes that are on', async () => {
      const { menus, view } = fakeView([]);
      await menuWith({ players: [modePlayer(true, 'playlist')], view }).open();
      const [shuffle, repeat] = modesOf(menus[0]);
      expect(shuffle).to.include({ label: 'shuffle on', active: true, disabled: false });
      expect(repeat).to.include({ label: 'repeat playlist', active: true, disabled: false });

      const off = fakeView([]);
      await menuWith({ players: [modePlayer(false, 'off')], view: off.view }).open();
      const [shuffleOff, repeatOff] = modesOf(off.menus[0]);
      expect(shuffleOff).to.include({ label: 'shuffle off', active: false });
      expect(repeatOff).to.include({ label: 'repeat off', active: false });
    });

    it('should toggle shuffle and step repeat to the next mode', async () => {
      const player = modePlayer(true, 'playlist');
      const { view } = fakeView([{ key: 'u' }, { key: 'r' }]);
      await menuWith({ players: [player], view }).open();
      expect(player.calls).to.deep.equal([
        ['shuffle', 'toggle'],
        ['repeat', 'track']
      ]);
    });

    it('should disable the modes for a player without them (MPD)', async () => {
      const { menus, view } = fakeView([{ key: 'u' }]);
      const reshuffle = { source: async () => 'Liked Songs', run: async () => {} };
      await menuWith({ players: [fakePlayer('mpd', 'playing')], view, reshuffle }).open();
      expect(modesOf(menus[0]).map(({ disabled }) => disabled)).to.deep.equal([true, true, true]);
    });

    it('should reshuffle the last source, disabled until there is one', async () => {
      const runs = [];
      const none = fakeView([]);
      await menuWith({
        players: [modePlayer(false, 'off')],
        view: none.view,
        reshuffle: { source: async () => null, run: async () => runs.push('run') }
      }).open();
      expect(modesOf(none.menus[0])[2]).to.include({ disabled: true });

      const { menus, view } = fakeView([{ key: 'o' }]);
      await menuWith({
        players: [modePlayer(false, 'off')],
        view,
        reshuffle: { source: async () => "Nick's Picks", run: async () => runs.push('run') }
      }).open();
      expect(modesOf(menus[0])[2]).to.include({
        caption: "reshuffle Nick's Picks",
        disabled: false
      });
      expect(runs).to.deep.equal(['run']);
    });
  });

  it('should run the control picked by index or key and stay open until q', async () => {
    const player = fakePlayer('spotify', 'playing');
    const { menus, view } = fakeView([2, { key: 'h' }, { key: 'equal' }, { key: 'q' }]);
    await menuWith({ players: [player], view }).open();
    expect(player.calls).to.deep.equal([['next'], ['seek', -10], ['volume', 5]]);
    expect(menus).to.have.length(4);
  });

  it('should switch to the other running player with Tab', async () => {
    const spotify = fakePlayer('spotify', 'playing');
    const mpd = fakePlayer('mpd', 'paused');
    const { menus, view } = fakeView([{ key: 'Tab' }, { key: 't' }]);
    await menuWith({ players: [spotify, mpd], view }).open();
    expect(menus[0].title).to.include('Spotify');
    expect(menus[1].title).to.include('MPD');
    expect(mpd.calls).to.deep.equal([['toggle']]);
    expect(spotify.calls).to.be.empty;
  });

  it('should do nothing for a disabled button, and announce a failed action without closing', async () => {
    const player = fakePlayer('mpd', 'playing');
    player.next = async () => {
      throw new Error('MPD went away');
    };
    const notes = [];
    const { menus, view } = fakeView([{ key: 'Tab' }, { key: 'n' }]);
    await menuWith({
      players: [player],
      view,
      notify: async message => notes.push(message)
    }).open();
    expect(menus[0].entries.find(({ key }) => key === 'Tab').disabled).to.equal(true);
    expect(notes).to.deep.equal(['MPD went away']);
    expect(menus).to.have.length(3);
  });

  it('should fail with a notification when neither player is running', async () => {
    const notes = [];
    const stopped = { ...fakePlayer('mpd', null), state: async () => ({ state: null }) };
    await menuWith({
      players: [stopped],
      view: fakeView([]).view,
      notify: async m => notes.push(m)
    })
      .open()
      .then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('Neither MPD nor Spotify is running')
      );
    expect(notes).to.deep.equal(['Neither MPD nor Spotify is running']);
  });

  it('should add the song buttons and details of songActions after the controls and modes', async () => {
    const ran = [];
    const songActions = {
      song: async () => ({ file: '/m/a.mp3', details: ['★★★★  4.0'], status: ['in library'] }),
      entries: async ({ song }) => [
        { label: `tag ${song.file}`, key: 'a', run: async () => ran.push('a') }
      ]
    };
    const { menus, view } = fakeView([{ key: 'a' }]);
    await menuWith({ players: [fakePlayer('spotify', 'playing')], view, songActions }).open();
    expect(menus[0].message).to.include('★★★★  4.0');
    expect(menus[0].status).to.include('in library');
    expect(menus[0].entries[11]).to.include({ label: 'tag /m/a.mp3' });
    expect(ran).to.deep.equal(['a']);
  });

  it('should draw the menu again when the song changes while it is open', async () => {
    const tracks = [
      { ...track, title: 'First', trackId: 't1' },
      { ...track, title: 'Second', trackId: 't2' }
    ];
    let calls = 0;
    const player = {
      ...fakePlayer('spotify', 'playing'),
      // the first draw and its first checks see the first track, later ones the second
      state: async () => {
        calls += 1;
        return { state: 'playing', volume: 50, track: tracks[calls < 4 ? 0 : 1] };
      }
    };
    const menus = [];
    // stays open until aborted for a redraw, the second menu is dismissed
    const view = menu =>
      new Promise(resolve => {
        menus.push(menu);
        if (menus.length > 1) {
          resolve(null);
        } else {
          menu.signal.addEventListener('abort', () => resolve({ redraw: true }));
        }
      });
    await new Menu({
      players: [player],
      view,
      cover: async () => null,
      settle: 0,
      follow: 2,
      notify: async () => {}
    }).open();
    expect(menus.map(menu => menu.title.split('·')[1].trim())).to.deep.equal(['First', 'Second']);
  });

  it('should leave the menu open without following when follow is 0', async () => {
    const { menus, view } = fakeView([]);
    await menuWith({ players: [fakePlayer('mpd', 'playing')], view, follow: 0 }).open();
    expect(menus[0].signal).to.equal(undefined);
  });

  it('should open the choices of an entry as a second menu, and go back on Escape', async () => {
    const ran = [];
    const songActions = {
      song: async () => ({}),
      entries: async () => [
        {
          label: 'grouping',
          key: 'g',
          choices: async () => [
            { label: 'Rock', run: async () => ran.push('Rock') },
            { label: 'Jazz', disabled: true, run: async () => ran.push('Jazz') }
          ]
        }
      ]
    };
    // g opens the choices, 0 picks Rock; g again, Escape (null) goes back; g, the disabled Jazz
    const { menus, view } = fakeView([
      { key: 'g' },
      0,
      { key: 'g' },
      null,
      { key: 'g' },
      1,
      { key: 'q' }
    ]);
    await menuWith({ players: [fakePlayer('mpd', 'playing')], view, songActions }).open();
    expect(ran).to.deep.equal(['Rock']);
    expect(menus[1].title).to.match(/grouping$/);
    expect(menus[1].entries.map(({ label }) => label)).to.deep.equal(['Rock', 'Jazz']);
    expect(menus[1].columns).to.equal(4);
    expect(menus).to.have.length(7);
  });

  it('should format times as m:ss', () => {
    expect(clock(0)).to.equal('0:00');
    expect(clock(354.44)).to.equal('5:54');
  });
});
