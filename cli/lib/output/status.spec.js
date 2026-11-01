const { expect } = require('chai');

const { describeFrom, progressBar, renderStatus, stars } = require('./status.js');

// eslint-disable-next-line no-control-regex
const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('Status Output', () => {
  const status = {
    player: { source: 'spotify', name: 'Spotify' },
    state: 'playing',
    volume: 80,
    shuffle: false,
    repeat: 'playlist',
    track: {
      title: 'Fade Into You',
      artist: 'Mazzy Star',
      album: 'So Tonight',
      position: 83,
      duration: 180
    },
    song: {
      file: '/music/Rated/a.mp3',
      inLibrary: true,
      trackId: 't1',
      fields: { rating: '4.5', grouping: 'Ambient.Artists', context: ['Study', 'Relax'] },
      playlists: ['Liked Songs', 'Study']
    },
    from: { type: 'playlist', name: 'Study' },
    others: [{ source: 'mpd', name: 'MPD', state: 'paused' }]
  };
  const lines = (value, options = {}) =>
    renderStatus(value, { icons: false, baseDirectory: '/music', ...options }).map(stripAnsi);

  it('should draw a bar of the given width with the times at both ends', () => {
    const bar = stripAnsi(progressBar(83, 180, 30));
    expect(bar).to.equal(`1:23 ${'━'.repeat(9)}${'─'.repeat(11)} 3:00`);
    expect(bar).to.have.length(30);
    expect(stripAnsi(progressBar(200, 180, 30))).to.not.include('─');
    expect(progressBar(83, 0, 30)).to.equal('1:23');
  });

  it('should show stars with a half star', () => {
    expect(stars('4.5')).to.equal('★★★★½');
    expect(stars('3.0')).to.equal('★★★');
    expect(stars(null)).to.equal('');
  });

  it('should describe the queue and Spotify contexts', () => {
    expect(describeFrom({ type: 'queue', position: 12, length: 340 })).to.equal('queue 12 of 340');
    expect(describeFrom({ type: 'playlist', name: 'Study' })).to.equal('playlist "Study"');
    expect(describeFrom({ type: 'show', name: null })).to.equal('show');
    expect(describeFrom(null)).to.equal(null);
  });

  it('should show the player, modes, song, progress, fields, playlists, source, and file', () => {
    const shown = lines(status);
    expect(shown[0]).to.equal('Spotify   ▶ playing   80%   shuffle off   repeat playlist');
    expect(shown.slice(2, 4)).to.deep.equal(['Fade Into You', 'Mazzy Star  ·  So Tonight']);
    expect(shown[4]).to.match(/^1:23 ━+─+ 3:00$/);
    expect(shown.slice(6, 13)).to.deep.equal([
      'rating     ★★★★½ 4.5',
      'grouping   Ambient.Artists',
      'context    Study, Relax',
      'playlists  Liked Songs, Study',
      'from       playlist "Study"',
      'file       Rated/a.mp3',
      ''
    ]);
    expect(shown[13]).to.equal('also MPD paused');
  });

  it('should label shuffle as random for MPD, and mark songs not in the library', () => {
    const shown = lines({
      ...status,
      player: { source: 'mpd', name: 'MPD' },
      shuffle: true,
      song: { file: null, inLibrary: false, trackId: null, fields: {}, playlists: [] },
      from: null,
      others: []
    });
    expect(shown[0]).to.include('random on');
    expect(shown.slice(6)).to.deep.equal(['library  not in the library']);
  });

  it('should show an unrated library song as unrated', () => {
    const shown = lines({ ...status, song: { ...status.song, fields: {} } });
    expect(shown[6]).to.equal('rating     unrated');
  });

  it('should add Nerd Font icons unless turned off', () => {
    const withIcons = renderStatus(status, { icons: true }).map(stripAnsi);
    expect(withIcons[0].startsWith('Spotify')).to.equal(false);
    expect(withIcons[6]).to.match(/^\S rating/);
  });

  it('should say nothing is playing', () => {
    expect(lines({ player: null, others: [] })).to.deep.equal(['Nothing is playing']);
  });
});
