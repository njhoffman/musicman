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
      'Tab'
    ]);
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

  it('should add the song buttons and details of songActions after the controls', async () => {
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
    expect(menus[0].entries[8]).to.include({ label: 'tag /m/a.mp3' });
    expect(ran).to.deep.equal(['a']);
  });

  it('should format times as m:ss', () => {
    expect(clock(0)).to.equal('0:00');
    expect(clock(354.44)).to.equal('5:54');
  });
});
