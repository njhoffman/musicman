const { expect } = require('chai');

const {
  choosePlayer,
  mpdPlayer,
  nextRepeat,
  parseMpdSongs,
  spotifyPlayer,
  spotifyTrackId
} = require('./players.js');

describe('Menu players', () => {
  it('should read Spotify track ids from URLs and URIs', () => {
    expect(spotifyTrackId('https://open.spotify.com/track/65iXgVBjiF7oOORNWo0hRV')).to.equal(
      '65iXgVBjiF7oOORNWo0hRV'
    );
    expect(spotifyTrackId('spotify:track:65iXgVBjiF7oOORNWo0hRV')).to.equal(
      '65iXgVBjiF7oOORNWo0hRV'
    );
    expect(spotifyTrackId('')).to.equal(null);
  });

  describe('mpdPlayer', () => {
    // a connection answering each command from replies, recording what was sent
    const fakeConnect = replies => {
      const sent = [];
      const connect = async () => ({
        socket: { destroy: () => {} },
        sendCommand: (command, callback) => {
          sent.push(command);
          callback(null, replies[command.split(' ')[0]] || '');
        }
      });
      return { sent, connect };
    };
    const config = { mpd: { baseDirectory: '/music' } };

    it('should play, pause, stop, seek to a position, and set the volume', async () => {
      const { sent, connect } = fakeConnect({ status: 'state: play\nvolume: 40\n' });
      const player = mpdPlayer(config, { connect });
      await player.play();
      await player.pause();
      await player.stop();
      await player.seekTo(90);
      await player.seekTo(-5);
      await player.setVolume(140);
      expect(sent).to.deep.equal([
        'play',
        'pause 1',
        'stop',
        'seekcur 90',
        'seekcur 0',
        'status',
        'setvol 100'
      ]);
    });

    it('should list the queue after the song playing', async () => {
      const { sent, connect } = fakeConnect({
        status: 'state: play\nsong: 4\nplaylistlength: 9\n',
        playlistinfo:
          'file: a/b.mp3\nTitle: B\nArtist: X\nduration: 61.2\nPos: 5\nfile: c.mp3\nPos: 6\nTime: 30\n'
      });
      expect(await mpdPlayer(config, { connect }).queue(2)).to.deep.equal({
        length: 9,
        current: 5,
        tracks: [
          { position: 6, file: '/music/a/b.mp3', title: 'B', artist: 'X', duration: 61.2 },
          { position: 7, file: '/music/c.mp3', title: 'c', artist: '', duration: 30 }
        ]
      });
      expect(sent).to.deep.equal(['status', 'playlistinfo 5:7']);
      expect(parseMpdSongs('OK')).to.deep.equal([]);
    });

    it('should report the playing song with its file under mpd.baseDirectory', async () => {
      const { connect } = fakeConnect({
        status: 'state: play\nvolume: 40\nelapsed: 12.5\nduration: 200.1\n',
        currentsong:
          'file: Rated/a.mp3\nTitle: Riders: on the Storm\nArtist: The Doors\nAlbum: L.A. Woman\n'
      });
      const status = await mpdPlayer(config, { connect }).state();
      expect(status).to.deep.equal({
        state: 'playing',
        volume: 40,
        shuffle: null,
        repeat: null,
        queue: null,
        track: {
          file: '/music/Rated/a.mp3',
          title: 'Riders: on the Storm',
          artist: 'The Doors',
          album: 'L.A. Woman',
          position: 12.5,
          duration: 200.1
        }
      });
    });

    it('should report random, repeat, single and the queue position like Spotify modes', async () => {
      const reply = extra =>
        fakeConnect({
          status: `state: pause\nvolume: n/a\nsong: 11\nplaylistlength: 340\n${extra}`,
          currentsong: 'file: a.mp3\n'
        }).connect;
      const playlist = await mpdPlayer(config, {
        connect: reply('random: 1\nrepeat: 1\nsingle: 0\n')
      }).state();
      expect(playlist).to.include({
        state: 'paused',
        volume: null,
        shuffle: true,
        repeat: 'playlist'
      });
      expect(playlist.queue).to.deep.equal({ position: 12, length: 340 });
      const track = await mpdPlayer(config, {
        connect: reply('random: 0\nrepeat: 1\nsingle: 1\n')
      }).state();
      expect(track).to.include({ shuffle: false, repeat: 'track' });
      const off = await mpdPlayer(config, {
        connect: reply('random: 0\nrepeat: 0\nsingle: 1\n')
      }).state();
      expect(off.repeat).to.equal('off');
    });

    it('should set random and repeat, repeat track through single', async () => {
      const { sent, connect } = fakeConnect({ status: 'state: play\nrandom: 1\n' });
      const player = mpdPlayer(config, { connect });
      await player.shuffle('toggle');
      await player.shuffle('on');
      await player.repeat('track');
      await player.repeat('playlist');
      await player.repeat('off');
      expect(sent).to.deep.equal([
        'status',
        'random 0',
        'random 1',
        'repeat 1',
        'single 1',
        'repeat 1',
        'single 0',
        'repeat 0',
        'single 0'
      ]);
      await player.shuffle('smart').then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.include("Unknown shuffle mode 'smart'")
      );
      await player.repeat('all').then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.include("Unknown repeat mode 'all'")
      );
    });

    it('should report a state of null when MPD cannot be reached', async () => {
      const connect = async () => {
        throw new Error('connect ECONNREFUSED');
      };
      expect(await mpdPlayer(config, { connect }).state()).to.deep.equal({
        state: null,
        error: 'connect ECONNREFUSED'
      });
    });

    it('should pause when playing, play otherwise, and step the volume within 0-100', async () => {
      const playing = fakeConnect({ status: 'state: play\nvolume: 98\n' });
      const player = mpdPlayer(config, { connect: playing.connect });
      await player.toggle();
      await player.volume(5);
      await player.seek(-10);
      expect(playing.sent).to.deep.equal([
        'status',
        'pause 1',
        'status',
        'setvol 100',
        'seekcur -10'
      ]);
      const paused = fakeConnect({ status: 'state: pause\nvolume: -1\n' });
      const other = mpdPlayer(config, { connect: paused.connect });
      await other.toggle();
      expect(paused.sent).to.deep.equal(['status', 'play']);
      await other.volume(5).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.include('no mixer')
      );
    });
  });

  describe('spotifyPlayer', () => {
    const fakeRun = output => {
      const calls = [];
      const run = async (bin, args) => {
        calls.push([bin, ...args]);
        return output;
      };
      return { calls, run };
    };

    it('should read the track, its cover, position, volume, shuffle and repeat from playerctl', async () => {
      const { run } = fakeRun(
        'Playing\thttps://open.spotify.com/track/65iXgVBjiF7oOORNWo0hRV\tFull Moon Rising\tNeil Halstead\tPalindrome Hunches\thttps://i.scdn.co/image/abc\t354440000\t216739029\t0.5\ttrue\tPlaylist\n'
      );
      expect(await spotifyPlayer({ run }).state()).to.deep.equal({
        state: 'playing',
        volume: 50,
        shuffle: true,
        repeat: 'playlist',
        track: {
          trackId: '65iXgVBjiF7oOORNWo0hRV',
          title: 'Full Moon Rising',
          artist: 'Neil Halstead',
          album: 'Palindrome Hunches',
          artUrl: 'https://i.scdn.co/image/abc',
          position: 216.739029,
          duration: 354.44
        }
      });
    });

    it('should report shuffle and repeat as null when playerctl leaves them out', async () => {
      const { run } = fakeRun('Paused\t\t\t\t\t\t\t\t\t\t\n');
      const state = await spotifyPlayer({ run }).state();
      expect(state).to.include({ shuffle: null, repeat: null });
      const off = await spotifyPlayer({
        run: fakeRun('Paused\t\t\t\t\t\t\t\t\tfalse\tNone\n').run
      }).state();
      expect(off).to.include({ shuffle: false, repeat: 'off' });
    });

    it('should set shuffle, repeat, and open URIs with playerctl', async () => {
      const { calls, run } = fakeRun('');
      const player = spotifyPlayer({ run });
      await player.shuffle('off');
      await player.shuffle('toggle');
      await player.repeat('track');
      await player.repeat('off');
      await player.open('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
      expect(calls).to.deep.equal([
        ['playerctl', '-p', 'spotify', 'shuffle', 'Off'],
        ['playerctl', '-p', 'spotify', 'shuffle', 'Toggle'],
        ['playerctl', '-p', 'spotify', 'loop', 'Track'],
        ['playerctl', '-p', 'spotify', 'loop', 'None'],
        ['playerctl', '-p', 'spotify', 'open', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M']
      ]);
    });

    it('should refuse unknown shuffle and repeat modes', () => {
      const player = spotifyPlayer({ run: fakeRun('').run });
      expect(() => player.shuffle('smart')).to.throw("Unknown shuffle mode 'smart'");
      expect(() => player.repeat('all')).to.throw("Unknown repeat mode 'all'");
    });

    it('should cycle repeat from off to playlist to track and back', () => {
      expect(nextRepeat('off')).to.equal('playlist');
      expect(nextRepeat('playlist')).to.equal('track');
      expect(nextRepeat('track')).to.equal('off');
      expect(nextRepeat(null)).to.equal('off');
    });

    it('should report a state of null when Spotify is not running', async () => {
      const run = async () => {
        throw new Error('No players found');
      };
      expect((await spotifyPlayer({ run }).state()).state).to.equal(null);
    });

    it('should play, pause, stop, seek to a position, and set the volume with playerctl', async () => {
      const { calls, run } = fakeRun('');
      const player = spotifyPlayer({ run });
      await player.play();
      await player.pause();
      await player.stop();
      await player.seekTo(90);
      await player.setVolume(40);
      expect(calls.map(call => call.slice(3))).to.deep.equal([
        ['play'],
        ['pause'],
        ['stop'],
        ['position', '90'],
        ['volume', '0.4']
      ]);
    });

    it('should seek and step the volume with relative playerctl arguments', async () => {
      const { calls, run } = fakeRun('');
      const player = spotifyPlayer({ run });
      await player.seek(-10);
      await player.volume(5);
      await player.toggle();
      expect(calls).to.deep.equal([
        ['playerctl', '-p', 'spotify', 'position', '10-'],
        ['playerctl', '-p', 'spotify', 'volume', '0.05+'],
        ['playerctl', '-p', 'spotify', 'play-pause']
      ]);
    });
  });

  describe('choosePlayer', () => {
    const player = (source, state) => ({ source, state: async () => ({ state }) });

    it('should pick the player that is playing, Spotify when both are', async () => {
      const mpd = player('mpd', 'playing');
      const spotify = player('spotify', 'paused');
      expect((await choosePlayer([spotify, mpd])).active.player).to.equal(mpd);
      const both = player('spotify', 'playing');
      expect((await choosePlayer([both, mpd])).active.player).to.equal(both);
    });

    it('should pick a paused player, the preferred one when both are paused', async () => {
      const mpd = player('mpd', 'paused');
      const spotify = player('spotify', 'paused');
      expect((await choosePlayer([spotify, mpd], { preferred: 'mpd' })).active.player).to.equal(
        mpd
      );
      expect((await choosePlayer([spotify, player('mpd', null)])).active.player).to.equal(spotify);
      expect(
        (await choosePlayer([player('spotify', null), player('mpd', 'stopped')])).active
      ).to.equal(null);
    });
  });
});
