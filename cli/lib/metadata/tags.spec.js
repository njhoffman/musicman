const { expect } = require('chai');
const { countTags, populatedFrames } = require('./tags.js');

describe('Tag Counts', () => {
  describe('populatedFrames', () => {
    it('should include text frames with values and skip blank ones', () => {
      expect(populatedFrames({ TPE1: 'Artist', TIT2: '  ', TALB: '' })).to.deep.equal(['TPE1']);
    });

    it('should include structured frames when present', () => {
      const frames = populatedFrames({ POPM: { rating: 128 }, APIC: true, COMM: [{ text: 'a' }] });
      expect(frames).to.deep.equal(['POPM', 'APIC', 'COMM']);
    });

    it('should identify TXXX fields by description and skip blank values', () => {
      const TXXX = [
        { description: 'Mood', value: 'Happy' },
        { description: 'Context', value: '' },
        { description: 'Mood', value: 'Sad' }
      ];
      expect(populatedFrames({ TXXX })).to.deep.equal(['TXXX.Mood']);
    });

    it('should handle a single TXXX field object', () => {
      expect(populatedFrames({ TXXX: { description: 'Picks', value: 'Best' } })).to.deep.equal([
        'TXXX.Picks'
      ]);
    });

    it('should ignore duration and size', () => {
      expect(populatedFrames({ duration: 180, size: 1024, TPE1: 'Artist' })).to.deep.equal([
        'TPE1'
      ]);
    });
  });

  describe('countTags', () => {
    const config = {
      library: { tags: [{ id: 'TXXX.Mood', name: 'mood' }] },
      tags: [{ id: 'TPE1', name: 'artist' }]
    };

    const rawTagsList = [
      { TPE1: 'A', TPE2: 'B', TXXX: [{ description: 'Mood', value: 'Happy' }], ZZZZ: 'x' },
      {
        TPE1: 'C',
        TXXX: [
          { description: 'COMMENT', value: 'c' },
          { description: 'Comment', value: 'c' }
        ]
      },
      { TPE1: '' }
    ];

    it('should count files with each populated frame', () => {
      const counts = countTags(rawTagsList, config);
      expect(counts.find(({ id }) => id === 'TPE1').count).to.equal(2);
      expect(counts.find(({ id }) => id === 'TPE2').count).to.equal(1);
    });

    it('should name frames by config, then tags.json, then frame id', () => {
      const names = countTags(rawTagsList, config).map(({ id, name }) => [id, name]);
      expect(names).to.deep.include(['TPE1', 'artist']);
      expect(names).to.deep.include(['TXXX.Mood', 'mood']);
      expect(names).to.deep.include(['TPE2', 'album_artist']);
      expect(names).to.deep.include(['ZZZZ', 'ZZZZ']);
      expect(names).to.deep.include(['TXXX.COMMENT', 'TXXX:COMMENT']);
    });

    it('should name the configured rating frame rating', () => {
      const counts = countTags([{ POPM: { rating: 128 } }], { ...config, rating: { tag: 'POPM' } });
      expect(counts).to.deep.equal([{ id: 'POPM', name: 'rating', count: 1 }]);
    });

    it('should sort alphabetically ignoring case and keep case variants separate', () => {
      const names = countTags(rawTagsList, config).map(({ name }) => name);
      expect(names).to.deep.equal([
        'album_artist',
        'artist',
        'mood',
        'TXXX:COMMENT',
        'TXXX:Comment',
        'ZZZZ'
      ]);
    });
  });
});
