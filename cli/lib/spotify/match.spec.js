const { expect } = require('chai');
const {
  bestCandidate,
  looseQuery,
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

    it('should trust ISRC matches within 5 seconds and review the rest', () => {
      expect(rateCandidate(song, track('Anything', ['Anyone'], 190), { isrc: true })).to.equal(
        'match'
      );
      expect(rateCandidate(song, track('Anything', ['Anyone'], 240), { isrc: true })).to.equal(
        'review'
      );
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

    it('should report missing when nothing qualifies', () => {
      expect(bestCandidate(song, [track('Other', ['Prince'], 568)])).to.deep.equal({
        status: 'missing',
        candidate: null
      });
    });
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
