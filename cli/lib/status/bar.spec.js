const { expect } = require('chai');

const { barDefaults, barText, formatRemaining, glyphs, renderBar, starOf } = require('./bar.js');

const { colors } = barDefaults;
const star = (color, glyph) => `%{F${color}}${glyph}%{F-}`;

const view = {
  source: 'spotify',
  state: 'playing',
  title: 'Fade Into You',
  artist: 'Mazzy Star',
  remaining: 137.9,
  liked: false,
  inLibrary: false,
  rating: null
};

describe('Bar line', () => {
  describe('starOf', () => {
    const cases = [
      ['no star outside the library', { inLibrary: false, rating: '5.0' }, ''],
      ['gray filled when unrated', { inLibrary: true }, star(colors.unrated, glyphs.starFilled)],
      [
        'gray filled for a zero rating',
        { inLibrary: true, rating: '0' },
        star(colors.unrated, glyphs.starFilled)
      ],
      [
        'a dim outline below 4.0',
        { inLibrary: true, rating: '3.5' },
        star(colors.low, glyphs.starOutline)
      ],
      [
        'a bright outline at 4.0',
        { inLibrary: true, rating: '4.0' },
        star(colors.star, glyphs.starOutline)
      ],
      [
        'a bright filled star at 4.5',
        { inLibrary: true, rating: '4.5' },
        star(colors.star, glyphs.starFilled)
      ],
      [
        'a gold filled star at 5.0',
        { inLibrary: true, rating: '5.0' },
        star(colors.gold, glyphs.starFilled)
      ]
    ];
    cases.forEach(([name, song, expected]) => {
      it(`should show ${name}`, () => {
        expect(starOf(song, colors)).to.equal(expected);
      });
    });
  });

  describe('formatRemaining', () => {
    it('should count down in minutes and seconds, whole seconds rounded down', () => {
      expect(formatRemaining(137.9)).to.equal('-2:17');
      expect(formatRemaining(5)).to.equal('-0:05');
    });

    it('should add hours from an hour', () => {
      expect(formatRemaining(3725)).to.equal('-1:02:05');
    });

    it('should stop at zero past the end, and show nothing for an unknown length', () => {
      expect(formatRemaining(-3)).to.equal('-0:00');
      expect(formatRemaining(null)).to.equal('');
    });
  });

  describe('barText', () => {
    it('should keep a line break out of the single line a bar reads', () => {
      expect(barText(' a\n b\tc ', 60)).to.equal('a b c');
    });

    it('should leave a plain percent sign and defuse a formatting tag', () => {
      expect(barText('100% Pure', 60)).to.equal('100% Pure');
      expect(barText('%{A1:rm -rf ~:}x%{A}', 60)).to.equal('% {A1:rm -rf ~:}x% {A}');
    });

    it('should cut long text with an ellipsis', () => {
      expect(barText('abcdefgh', 5)).to.equal('abcd…');
    });
  });

  describe('renderBar', () => {
    const icon = source => `%{F${colors[source]}}${glyphs[source]}%{F-}`;

    it('should render nothing when nothing plays', () => {
      expect(renderBar(null, {})).to.equal('');
    });

    it('should show the player, text and time left, leaving no gaps for a missing heart and star', () => {
      expect(renderBar(view, {})).to.equal(
        `${icon('spotify')} %{F${colors.text}}Fade Into You - Mazzy Star%{F-} %{F${colors.time}}-2:17%{F-}`
      );
    });

    it('should show the heart then the star, for MPD as for Spotify', () => {
      const line = renderBar(
        { ...view, source: 'mpd', liked: true, inLibrary: true, rating: '5.0' },
        {}
      );
      expect(
        line.startsWith(`${icon('mpd')} ${glyphs.heart} ${star(colors.gold, glyphs.starFilled)} `)
      ).to.be.true;
    });

    it('should dim a paused song and show the pause glyph before it', () => {
      expect(renderBar({ ...view, state: 'paused' }, {})).to.contain(
        `${star(colors.paused, glyphs.pause)} %{F${colors.paused}}Fade`
      );
    });

    it('should leave out the time for an unknown length, and the dash without an artist', () => {
      const line = renderBar({ ...view, artist: '', remaining: null }, {});
      expect(line).to.equal(`${icon('spotify')} %{F${colors.text}}Fade Into You%{F-}`);
    });

    it('should take colors and length from config.bar over the defaults', () => {
      const line = renderBar(view, { bar: { maxLength: 5, colors: { spotify: '#123456' } } });
      expect(line).to.contain('%{F#123456}');
      expect(line).to.contain(`%{F${colors.text}}Fade…%{F-}`);
    });
  });
});
