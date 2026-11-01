const { expect } = require('chai');
const { pathLayouts, songLayout, templatePattern } = require('./layout.js');

describe('Beets Layout', () => {
  const paths = {
    'grouping:IndieRock.Artists':
      'Rated/Rock/Indie-Rock/Artists/$albumartist/$albumtype/$year - $album%aunique{}/$track - $title',
    'grouping:IndieRock.Singles': 'Rated/Rock/Indie-Rock/Singles/$artist - $title',
    'grouping:Ambient.Singles': 'Rated/Electronica/Ambient & Instrumental/Singles/$artist - $title',
    'comp:true': 'Unrated/$albumartist/$year - $album%aunique{}/$track - $title',
    'singleton:true': 'Unrated/_Singles/$artist - $title',
    default: 'Unrated/$albumartist/$year - $album%aunique{}/$track - $title'
  };
  const layouts = pathLayouts(paths);

  describe('templatePattern', () => {
    it('should match any text for variables and functions within one path segment', () => {
      const pattern = templatePattern(
        'Unrated/$albumartist/$year - ${album}%aunique{}/$track - $title'
      );
      expect(
        pattern.test('Unrated/Mazzy Star/1993 - So Tonight [2]/04 - Fade Into You.mp3')
      ).to.equal(true);
      expect(pattern.test('Unrated/Mazzy Star/04 - Fade Into You.mp3')).to.equal(false);
      expect(pattern.test('Unrated/A/B/1993 - X/04 - Y.mp3')).to.equal(false);
    });

    it('should need a file extension and treat regex characters as literal text', () => {
      const pattern = templatePattern('Rated/Rap-R&B (x)/Singles/$artist - $title');
      expect(pattern.test('Rated/Rap-R&B (x)/Singles/A - B.mp3')).to.equal(true);
      expect(pattern.test('Rated/Rap-R&B (x)/Singles/A - B')).to.equal(false);
      expect(pattern.test('Rated/Rap-R&B xx/Singles/A - B.mp3')).to.equal(false);
    });
  });

  describe('songLayout', () => {
    it('should tell album folders from singles by whether the rule has $album', () => {
      expect(
        songLayout(
          layouts,
          'Rated/Rock/Indie-Rock/Artists/Pavement/album/1992 - Slanted/01 - Summer.mp3'
        )
      ).to.equal('album');
      expect(
        songLayout(layouts, 'Rated/Rock/Indie-Rock/Singles/Pavement - Gold Soundz.mp3')
      ).to.equal('single');
      expect(
        songLayout(layouts, 'Rated/Electronica/Ambient & Instrumental/Singles/Eno - 1-1.mp3')
      ).to.equal('single');
    });

    it('should not take $albumartist or $albumtype for $album', () => {
      const own = pathLayouts({ default: 'Artists/$albumartist/$albumtype/$title' });
      expect(songLayout(own, 'Artists/A/single/B.mp3')).to.equal('single');
    });

    it('should prefer the rule with the most literal text when several match', () => {
      expect(songLayout(layouts, 'Unrated/_Singles/Mazzy Star - Fade Into You.mp3')).to.equal(
        'single'
      );
      expect(songLayout(layouts, 'Unrated/Mazzy Star/1993 - So Tonight/04 - Fade.mp3')).to.equal(
        'album'
      );
    });

    it('should be null for paths no rule matches or without rules', () => {
      expect(songLayout(layouts, 'Elsewhere/song.mp3')).to.equal(null);
      expect(songLayout(pathLayouts(undefined), 'Unrated/_Singles/A - B.mp3')).to.equal(null);
    });
  });
});
