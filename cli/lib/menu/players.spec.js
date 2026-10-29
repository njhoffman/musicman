const { expect } = require('chai');

const {
  choosePlayer,
  mpdPlayer,
  parseMpdReply,
  spotifyPlayer,
  spotifyTrackId
} = require('./players.js');

describe('Menu players', () => {
  it('should split MPD replies on the first colon only', () => {
    expect(parseMpdReply('Title: Foo: Bar\nfile: a/b.mp3\nOK')).to.deep.equal({
      Title: 'Foo: Bar',
      file: 'a/b.mp3'
    });
  });

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

    it('should read the track, its cover, position and volume from playerctl', async () => {
      const { run } = fakeRun(
        'Playing\thttps://open.spotify.com/track/65iXgVBjiF7oOORNWo0hRV\tFull Moon Rising\tNeil Halstead\tPalindrome Hunches\thttps://i.scdn.co/image/abc\t354440000\t216739029\t0.5\n'
      );
      expect(await spotifyPlayer({ run }).state()).to.deep.equal({
        state: 'playing',
        volume: 50,
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

    it('should report a state of null when Spotify is not running', async () => {
      const run = async () => {
        throw new Error('No players found');
      };
      expect((await spotifyPlayer({ run }).state()).state).to.equal(null);
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
