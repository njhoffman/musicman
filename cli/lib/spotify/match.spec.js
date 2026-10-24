const { expect } = require('chai');
const {
  bestCandidate,
  isLiveAlbum,
  looseQuery,
  matchSimilarity,
  normalizeTitle,
  primaryArtist,
  rateCandidate,
  searchQuery
} = require('./match.js');

const track = (name, artists, seconds, id = 'id') => ({
  id,
  name,
  artists: artists.map(artist => ({ name: artist })),
  album: { name: 'Album' },
  duration_ms: seconds * 1000
});

describe('Spotify Matching', () => {
  describe('normalizeTitle', () => {
    it('should strip noise suffixes and featured artists', () => {
      expect(normalizeTitle('Custard Pie - Remaster')).to.equal('custard pie');
      expect(normalizeTitle('Strange Days - New Stereo Mix')).to.equal('strange days');
      expect(normalizeTitle('Black Mud (Remastered 2010)')).to.equal('black mud');
      expect(normalizeTitle('Hold feat. Daniela Andrade - Original Mix')).to.equal('hold');
    });

    it('should keep version markers and fold case, accents, and punctuation', () => {
      expect(normalizeTitle('Fall In Love (NEUS Remix)')).to.equal('fall in love neus remix');
      expect(normalizeTitle('Café Del Mar (Live)')).to.equal('cafe del mar live');
      expect(normalizeTitle("Just Gazin'")).to.equal(normalizeTitle('Just Gazin'));
    });
  });

  it('should take the first credited artist', () => {
    expect(primaryArtist('Danger Mouse & Daniele Luppi feat. Norah Jones')).to.equal(
      'danger mouse'
    );
    expect(primaryArtist('The Doors')).to.equal('doors');
  });

  describe('rateCandidate', () => {
    const song = { artist: 'The Doors', title: 'Strange Days', duration: 186 };

    it('should match the same title and artist within 3 seconds', () => {
      expect(rateCandidate(song, track('Strange Days', ['The Doors'], 188))).to.equal('match');
    });

    it('should send the same title and artist with a longer duration difference to review', () => {
      expect(rateCandidate(song, track('Strange Days', ['The Doors'], 200))).to.equal('review');
      expect(rateCandidate(song, track('Strange Days', ['The Doors'], 300))).to.be.null;
    });

    it('should not match a different version or artist', () => {
      expect(rateCandidate(song, track('Strange Days - Live', ['The Doors'], 186))).to.be.null;
      expect(rateCandidate(song, track('Strange Days', ['Someone Else'], 186))).to.be.null;
    });

    it('should trust ISRC matches with the same title within 5 seconds and review the rest', () => {
      expect(
        rateCandidate(song, track(`${song.title} - 2011 Remaster`, ['Anyone'], 190), { isrc: true })
      ).to.equal('match');
      expect(rateCandidate(song, track(song.title, ['Anyone'], 240), { isrc: true })).to.equal(
        'review'
      );
      // an ISRC shared by another version (Happy Home and Happy Home II)
      expect(
        rateCandidate(song, track(`${song.title} II`, ['Anyone'], 190), { isrc: true })
      ).to.equal('review');
    });

    it('should review a candidate whose suffix names another mix, edit, or version', () => {
      const rise = { artist: 'Miura Keys', title: 'Rise (Miura Keys Campfire mix)', duration: 300 };
      expect(
        rateCandidate(rise, track('Rise [Mix Cut] - Crom & Thanh Dub Mix', ['Miura Keys'], 300))
      ).to.equal('review');
      const stp = { artist: 'Stone Temple Pilots', title: 'Interstate Love Song', duration: 194 };
      expect(
        rateCandidate(
          stp,
          track(
            'Interstate Love Song (Early Version) - 2019 Remaster',
            ['Stone Temple Pilots'],
            195
          )
        )
      ).to.equal('review');
      expect(
        rateCandidate(
          stp,
          track('Interstate Love Song - 2019 Remaster', ['Stone Temple Pilots'], 195)
        )
      ).to.equal('match');
    });
  });

  describe('bestCandidate', () => {
    const song = { artist: 'Prince', title: 'Automatic', duration: 568 };

    it('should prefer matches, then the closest duration', () => {
      const result = bestCandidate(song, [
        track('Automatic', ['Prince'], 580, 'review'),
        track('Automatic - 2019 Remaster', ['Prince'], 566, 'close'),
        track('Automatic', ['Prince'], 569, 'closest')
      ]);
      expect(result).to.deep.include({ status: 'match' });
      expect(result.candidate).to.include({ id: 'closest', artists: 'Prince', album: 'Album' });
    });

    it('should match review candidates at least autoAcceptPercent similar', () => {
      const tracks = [track('Automatic', ['Prince'], 586, 'longer')];
      expect(bestCandidate(song, tracks).status).to.equal('review');
      const accepted = bestCandidate(song, tracks, { autoAcceptPercent: 95 });
      expect(accepted).to.deep.include({ status: 'match' });
      expect(accepted.similarity).to.deep.equal({ percent: 96, details: 'duration 18.0s -3.5' });
    });

    it('should keep a differently named mix in review whatever the threshold allows for duration', () => {
      const tracks = [track('Automatic - Dub Mix', ['Prince'], 568, 'dub')];
      expect(bestCandidate(song, tracks, { autoAcceptPercent: 95 }).status).to.equal('review');
    });

    it('should report missing when nothing qualifies', () => {
      expect(bestCandidate(song, [track('Other', ['Prince'], 568)])).to.deep.equal({
        status: 'missing',
        candidate: null
      });
    });
  });

  describe('matchSimilarity', () => {
    const song = { title: 'Hey You', duration: 280 };
    const similarity = (name, seconds) =>
      matchSimilarity(song, { name, durationMs: seconds * 1000 });

    it('should be 100 for the same title and length, ignoring case and punctuation', () => {
      expect(similarity('Hey, you!', 282)).to.deep.equal({ percent: 100, details: '' });
    });

    it('should cost a little for parenthesized noise and small title changes', () => {
      expect(similarity('Hey You (2011 Remaster)', 280)).to.deep.equal({
        percent: 99,
        details: 'suffix -1'
      });
      expect(similarity('Hey Yu', 280)).to.deep.equal({ percent: 98, details: 'title 1 chars -2' });
    });

    it('should stay above 95 up to 20 seconds and fall off after', () => {
      expect(similarity('Hey You', 300).percent).to.equal(96);
      expect(similarity('Hey You', 330).percent).to.equal(81);
    });

    it('should fall below 95 for another mix, edit, or version', () => {
      expect(similarity('Hey You (Radio Edit)', 280)).to.deep.equal({
        percent: 90,
        details: 'suffix +radio -10'
      });
      expect(similarity('Hey You - Live', 280).percent).to.be.below(80);
    });

    it('should treat a song from a live album as live even when its title does not say so', () => {
      const studio = { name: 'Down', durationMs: 172000, album: '311' };
      const live = {
        name: 'Down',
        durationMs: 172000,
        album: 'Down (Live at the Hollywood Palladium)'
      };
      const fromLiveAlbum = { title: 'Down', duration: 172, albumType: 'album; live' };
      expect(matchSimilarity(fromLiveAlbum, studio)).to.deep.equal({
        percent: 75,
        details: 'version -live -25'
      });
      expect(matchSimilarity(fromLiveAlbum, live).percent).to.equal(100);
      expect(matchSimilarity({ title: 'Down', duration: 172 }, live).percent).to.equal(75);
      expect(
        matchSimilarity({ title: 'Down', duration: 172, album: 'Live at Luther College' }, studio)
          .percent
      ).to.equal(75);
    });
  });

  describe('isLiveAlbum', () => {
    it('should spot live album titles without catching titles that only use the word', () => {
      [
        'Stop Making Sense (Live)',
        'Live at Luther College',
        'I Might Be Wrong: Live Recordings',
        'Trouble: Norwegian Live EP',
        'Live',
        'Once in a Lifetime [Live at the Pantages Theatre, December 1983]'
      ].forEach(album => expect(isLiveAlbum(album), album).to.be.true);
      ["I Don't Live Here Anymore", 'Live Through This', 'Alive', 'Delivery'].forEach(
        album => expect(isLiveAlbum(album), album).to.be.false
      );
    });
  });

  it('should keep search queries under the 250 character limit for very long titles', () => {
    const song = {
      artist: 'Sufjan Stevens',
      title: `The Black Hawk War, Or, How to Demolish an Entire Civilization ${'and Still Feel Good '.repeat(12)}`
    };
    expect(searchQuery(song).length).to.be.below(250);
    expect(looseQuery(song).length).to.be.below(250);
    expect(searchQuery(song)).to.match(/^track:"The Black Hawk War, Or, How to Demolish/);
  });

  it('should build field and loose search queries', () => {
    expect(searchQuery({ title: 'Fall In Love (NEUS Remix)', artist: 'Phantogram' })).to.equal(
      'track:"Fall In Love NEUS Remix" artist:"Phantogram"'
    );
    expect(
      searchQuery({ title: 'Black (feat. Norah Jones)', artist: 'Danger Mouse & Daniele Luppi' })
    ).to.equal('track:"Black" artist:"Danger Mouse"');
    expect(looseQuery({ title: 'Fix You', artist: 'Coldplay' })).to.equal('fix you coldplay');
  });
});
