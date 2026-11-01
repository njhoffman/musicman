const { expect } = require('chai');

const { describeState, parseArgs, parseSeek, parseVolume, run } = require('./player.js');

describe('Player command', () => {
  const config = { mpd: { baseDirectory: '/music' } };
  const track = { title: 'Song', artist: 'Artist', position: 61, duration: 200 };

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
      state: async () => ({
        state,
        volume: 50,
        shuffle: false,
        repeat: 'off',
        track: state ? track : null,
        ...extra
      }),
      ...Object.fromEntries(
        [
          'toggle',
          'play',
          'pause',
          'stop',
          'next',
          'prev',
          'seek',
          'seekTo',
          'volume',
          'setVolume',
          'shuffle',
          'repeat'
        ].map(name => [name, record(name)])
      ),
      queue: async count => ({
        length: 5,
        current: 2,
        tracks: [{ position: 3, title: 'Next', artist: 'A', duration: 90 }].slice(0, count)
      })
    };
  };

  const songs = [
    ['/music/a.mp3', { title: 'A', sp_track_id: 'ta' }],
    ['/music/b.mp3', { title: 'B' }],
    ['/music/c.mp3', { title: 'C', sp_track_id: 'tc' }]
  ];

  // runs the command with fakes, recording queued MPD songs, played Spotify ids and Web API requests
  const runWith = async (terms, players, extra = {}) => {
    const queued = [];
    const played = [];
    const requests = [];
    const result = await run({
      options: { terms },
      config,
      players,
      settle: 0,
      find: async ({ terms: searched }) => (searched.includes('none') ? [] : songs),
      queue: async (mpdConfig, paths, options) => {
        queued.push([paths, options]);
        return paths.length;
      },
      play: async (client, ids) => {
        played.push(ids);
        return { device: 'charon', count: ids.length };
      },
      client: () => ({
        request: async (method, url) => requests.push([method, url]),
        get: async () => ({
          queue: [{ name: 'Up', artists: [{ name: 'X' }, { name: 'Y' }], duration_ms: 125000 }]
        })
      }),
      ...extra
    });
    return { result, queued, played, requests };
  };

  describe('parseArgs', () => {
    it('should read the player, the action and its arguments, status by default', () => {
      expect(parseArgs([])).to.deep.equal({ source: null, action: 'status', args: [] });
      expect(parseArgs(['MPD', 'seek', '-30'])).to.deep.equal({
        source: 'mpd',
        action: 'seek',
        args: ['-30']
      });
      expect(parseArgs(['volume', '+5']).action).to.equal('vol');
      expect(parseArgs(['previous']).action).to.equal('prev');
      expect(parseArgs(['play', 'context:Study']).args).to.deep.equal(['context:Study']);
    });

    it('should refuse unknown actions and values they do not take', () => {
      expect(() => parseArgs(['skip'])).to.throw("Unknown action 'skip'");
      expect(() => parseArgs(['seek', 'later'])).to.throw('seek takes +seconds');
      expect(() => parseArgs(['vol', '150'])).to.throw('vol takes');
      expect(() => parseArgs(['shuffle', 'smart'])).to.throw('shuffle takes on, off, or toggle');
      expect(() => parseArgs(['repeat', 'all'])).to.throw('repeat takes off, playlist, track');
      expect(() => parseArgs(['queue', 'all'])).to.throw('queue takes a count');
      expect(() => parseArgs(['add'])).to.throw('add needs search terms');
    });

    it('should read relative and absolute seek positions and volumes', () => {
      expect(parseSeek('+30')).to.deep.equal({ relative: 30 });
      expect(parseSeek('-30')).to.deep.equal({ relative: -30 });
      expect(parseSeek('90')).to.deep.equal({ absolute: 90 });
      expect(parseSeek('1:30')).to.deep.equal({ absolute: 90 });
      expect(() => parseSeek('1:75')).to.throw();
      expect(parseVolume('-5')).to.deep.equal({ relative: -5 });
      expect(parseVolume('40')).to.deep.equal({ absolute: 40 });
    });
  });

  describe('controls', () => {
    it('should act on the active player, Spotify when both play, and show its state', async () => {
      const spotify = fakePlayer('spotify', 'playing');
      const mpd = fakePlayer('mpd', 'playing');
      const { result } = await runWith(['next'], [spotify, mpd]);
      expect(spotify.calls).to.deep.equal([['next']]);
      expect(mpd.calls).to.be.empty;
      expect(result).to.include({ source: 'spotify', action: 'next', state: 'playing' });
    });

    it('should act on the player named first, and refuse one that is not running', async () => {
      const spotify = fakePlayer('spotify', 'playing');
      const mpd = fakePlayer('mpd', 'stopped');
      await runWith(['mpd', 'play'], [spotify, mpd]);
      expect(mpd.calls).to.deep.equal([['play']]);
      await runWith(['spotify', 'vol', '+5'], [fakePlayer('spotify', null), mpd]).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('Spotify is not running')
      );
    });

    it('should seek and set the volume relatively or absolutely, and step repeat', async () => {
      const mpd = fakePlayer('mpd', 'paused');
      await runWith(['seek', '-30'], [mpd]);
      await runWith(['seek', '1:30'], [mpd]);
      await runWith(['vol', '+5'], [mpd]);
      await runWith(['vol', '40'], [mpd]);
      await runWith(['shuffle', 'toggle'], [mpd]);
      await runWith(['repeat', 'next'], [mpd]);
      expect(mpd.calls).to.deep.equal([
        ['seek', -30],
        ['seekTo', 90],
        ['volume', 5],
        ['setVolume', 40],
        ['shuffle', 'toggle'],
        ['repeat', 'playlist']
      ]);
    });

    it('should show the status without sending anything, and fail when nothing runs', async () => {
      const mpd = fakePlayer('mpd', 'stopped');
      const { result } = await runWith([], [fakePlayer('spotify', null), mpd]);
      expect(result).to.include({ source: 'mpd', action: 'status', state: 'stopped' });
      expect(mpd.calls).to.be.empty;
      await runWith(['next'], [fakePlayer('spotify', null), fakePlayer('mpd', null)]).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('Neither MPD nor Spotify is running')
      );
    });

    it('should describe a player state in one line', () => {
      expect(
        describeState(
          { name: 'Spotify' },
          { state: 'playing', track, volume: 80, shuffle: true, repeat: 'track' }
        )
      ).to.equal(
        'Spotify playing  ·  Artist - Song  ·  1:01 / 3:20  ·  vol 80%  ·  shuffle on  ·  repeat track'
      );
      expect(describeState({ name: 'MPD' }, { state: 'stopped', volume: null })).to.equal(
        'MPD stopped'
      );
    });
  });

  describe('play and add search results', () => {
    it('should play songs in MPD when no player is active, replacing the queue', async () => {
      const mpd = fakePlayer('mpd', 'stopped');
      const spotify = fakePlayer('spotify', null);
      const { queued, result } = await runWith(['play', 'context:Study'], [spotify, mpd]);
      expect(queued).to.deep.equal([[['a.mp3', 'b.mp3', 'c.mp3'], { replace: true }]]);
      expect(result.result).to.deep.equal({ source: 'mpd', count: 3 });
    });

    it('should add songs to the MPD queue', async () => {
      const { queued } = await runWith(['mpd', 'add', 'rating:5'], [fakePlayer('mpd', 'playing')]);
      expect(queued[0][1]).to.deep.equal({ replace: false });
    });

    it('should play the Spotify ids of songs on the active Spotify, leaving out songs without one', async () => {
      const spotify = fakePlayer('spotify', 'paused');
      const mpd = fakePlayer('mpd', 'stopped');
      const { played, queued, result } = await runWith(['play', 'mood:Mellow'], [spotify, mpd]);
      expect(played).to.deep.equal([['ta', 'tc']]);
      expect(queued).to.be.empty;
      expect(result.result).to.deep.equal({ source: 'spotify', count: 2, device: 'charon' });
    });

    it('should add songs to the Spotify queue one track at a time', async () => {
      const { requests } = await runWith(
        ['spotify', 'add', 'mood:Mellow'],
        [fakePlayer('spotify', 'playing')]
      );
      expect(requests).to.deep.equal([
        ['POST', '/me/player/queue?uri=spotify%3Atrack%3Ata'],
        ['POST', '/me/player/queue?uri=spotify%3Atrack%3Atc']
      ]);
    });

    it('should fail when no song matches, or none has a Spotify id', async () => {
      await runWith(['play', 'none'], [fakePlayer('mpd', 'stopped')]).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('No songs match none')
      );
      await runWith(['spotify', 'play', 'x'], [fakePlayer('spotify', 'playing')], {
        find: async () => [songs[1]]
      }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('None of the 1 matching song has a Spotify id')
      );
    });
  });

  describe('queue', () => {
    it('should list the MPD queue after the song playing', async () => {
      const { result } = await runWith(['queue', '1'], [fakePlayer('mpd', 'playing')]);
      expect(result).to.deep.equal({
        source: 'mpd',
        length: 5,
        tracks: [{ position: 3, title: 'Next', artist: 'A', duration: 90 }]
      });
    });

    it('should list the Spotify queue from the Web API', async () => {
      const { result } = await runWith(['queue'], [fakePlayer('spotify', 'playing')]);
      expect(result).to.deep.equal({
        source: 'spotify',
        tracks: [{ title: 'Up', artist: 'X, Y', duration: 125 }]
      });
    });
  });
});
