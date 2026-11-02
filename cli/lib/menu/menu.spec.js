const { expect } = require('chai');

const { Menu, clock, progressBar } = require('./menu.js');

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
      expect(menu.title).to.equal(source === 'mpd' ? '  MPD' : '  Spotify');
      const [title, artist, progress] = menu.message.split('\n');
      expect(title).to.equal('<span font_size="large"><b>Song</b></span>');
      expect(artist).to.equal('<b>Artist</b>  ·  <span alpha="65%">Album</span>');
      expect(progress).to.match(/^▶ {2}1:01 {2}<span.*<\/span> {2}3:20$/);
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
      'u',
      'r',
      'o'
    ]);
  });

  it('should open with next selected and the buttons in two rows', async () => {
    const { menus, view } = fakeView([]);
    await menuWith({ players: [fakePlayer('spotify', 'playing')], view }).open();
    expect(menus[0].selected).to.equal(2);
    expect(menus[0].columns).to.equal(5);
  });

  it('should draw the progress bar in accent, the played part filled', () => {
    expect(progressBar(50, 100, '#fff', 11)).to.equal(
      '<span foreground="#fff">━━━━━●</span><span alpha="35%">─────</span>'
    );
    expect(progressBar(0, 0, '#fff', 3)).to.include('●</span><span alpha="35%">──</span>');
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
    expect(player.calls).to.deep.equal([['next'], ['seek', -30], ['volume', 5]]);
    expect(menus).to.have.length(4);
  });

  it('should control the player that plays, Spotify when both do, without a switch button', async () => {
    const spotify = fakePlayer('spotify', 'paused');
    const mpd = fakePlayer('mpd', 'playing');
    const { menus, view } = fakeView([{ key: 't' }]);
    await menuWith({ players: [spotify, mpd], view }).open();
    expect(menus[0].title).to.include('MPD');
    expect(mpd.calls).to.deep.equal([['toggle']]);
    expect(menus[0].keys).to.deep.equal(['q']);

    const both = fakeView([]);
    await menuWith({
      players: [fakePlayer('mpd', 'playing'), fakePlayer('spotify', 'playing')],
      view: both.view
    }).open();
    expect(both.menus[0].title).to.include('Spotify');
  });

  it('should do nothing for a disabled button, and announce a failed action without closing', async () => {
    const player = fakePlayer('mpd', 'playing', { volume: null });
    player.next = async () => {
      throw new Error('MPD went away');
    };
    const notes = [];
    const { menus, view } = fakeView([{ key: 'minus' }, { key: 'n' }]);
    await menuWith({
      players: [player],
      view,
      notify: async message => notes.push(message)
    }).open();
    expect(menus[0].entries.find(({ key }) => key === 'minus').disabled).to.equal(true);
    expect(player.calls).to.be.empty;
    expect(notes).to.deep.equal(['MPD went away']);
    expect(menus).to.have.length(3);
  });

  it('should announce a notice an action returns once, also from a choice of a second menu', async () => {
    const notes = [];
    const errors = [];
    const { view } = fakeView([{ key: 'g' }, 0, null, { key: 'q' }]);
    await menuWith({
      players: [fakePlayer('mpd', 'playing')],
      view,
      notify: async m => errors.push(m),
      notice: async m => notes.push(m),
      songActions: {
        song: async () => ({}),
        entries: async () => [
          {
            key: 'g',
            label: 'Rate',
            choices: async () => [{ label: '5.0', run: async () => ({ notice: 'not moved' }) }]
          }
        ]
      }
    }).open();
    expect(notes).to.deep.equal(['not moved']);
    expect(errors).to.be.empty;
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
    expect(menus[0].entries[10]).to.include({ label: 'tag /m/a.mp3' });
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
    expect(menus.map(menu => /<b>(\w+)<\/b>/.exec(menu.message)[1])).to.deep.equal([
      'First',
      'Second'
    ]);
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
    expect(menus[1]).to.include({ columns: 4, plain: true });
    // typing filters a submenu, so q is not bound there
    expect(menus[1].keys).to.deep.equal([]);
    expect(menus).to.have.length(7);
  });

  it('should keep a stay submenu open after a pick, drawn again from the song read anew', async () => {
    let tagged = false;
    const songActions = {
      song: async () => ({ details: [tagged ? 'is-tagged' : 'not-tagged'] }),
      entries: async () => [
        {
          label: 'tags',
          key: 'e',
          stay: true,
          columns: 6,
          choices: async () => [
            {
              label: 'Study',
              active: tagged,
              run: async () => {
                tagged = !tagged;
              }
            },
            { label: 'Off', disabled: true, run: async () => expect.fail('disabled') },
            { label: 'Info' }
          ]
        }
      ]
    };
    // e opens tags, 0 toggles Study (menu stays), 1 is disabled (stays), Escape goes back; e, then 2
    // has no run and goes back
    const { menus, view } = fakeView([{ key: 'e' }, 0, 1, null, { key: 'e' }, 2, { key: 'q' }]);
    await menuWith({ players: [fakePlayer('mpd', 'playing')], view, songActions }).open();
    expect(tagged).to.equal(true);
    expect(menus.map(({ title }) => (title.includes('tags') ? 'tags' : 'main'))).to.deep.equal([
      'main',
      'tags',
      'tags',
      'tags',
      'main',
      'tags',
      'main'
    ]);
    expect(menus[1].message).to.include('not-tagged');
    expect(menus[2].message).to.include('is-tagged');
    expect(menus[2].entries[0].active).to.equal(true);
    expect(menus[1].columns).to.equal(6);
  });

  it('should format times as m:ss', () => {
    expect(clock(0)).to.equal('0:00');
    expect(clock(354.44)).to.equal('5:54');
  });
});
