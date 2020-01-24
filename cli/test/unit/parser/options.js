const parser = require('../../../lib/parser');
const initUtils = require('../../../lib/utils/');

describe('Options assignment', () => {
  const config = {
    mpd: { baseDirectory: 'testBaseDir' },
    tags: [
      {
        name: 'artist',
        id: 'TPE1'
      },
      {
        name: 'title',
        id: 'TIT2'
      },
      {
        name: 'album',
        id: 'TALB'
      },
      {
        name: 'CustomField1',
        id: 'TXXX.Custom1',
        multi: true
      },
      {
        name: 'CustomField2',
        id: 'TXXX.Custom2',
        multi: true
      },
      {
        name: 'CustomField3',
        id: 'TXXX.Custom3'
      }
    ]
  };

  const utils = initUtils(config);

  describe('Switches', () => {
    it('Should parse recursive switches correctly', () => {
      const test1 = parser({ args: ['-r'], config, utils });
      const test2 = parser({ args: ['-nr'], config, utils });
      expect(test1.options.switches).to.include({ recursive: true });
      expect(test2.options.switches).to.include({ recursive: false });
    });

    it('Should parse inclusion output fields switch correctly', () => {
      const test1 = parser({ args: ['-i', 'artist'], config, utils });
      const test2 = parser({ args: ['-i', 'artist,title'], config, utils });
      expect(test1.options.switches).to.deep.include({ include: ['artist'] });
      expect(test2.options.switches).to.deep.include({ include: ['artist', 'title'] });
    });

    it('Should parse exclusion output fields switch correctly', () => {
      const test1 = parser({ args: ['-x', 'artist'], config, utils });
      const test2 = parser({ args: ['-x', 'artist,title'], config, utils });
      expect(test1.options.switches).to.deep.include({ exclude: ['artist'] });
      expect(test2.options.switches).to.deep.include({ exclude: ['artist', 'title'] });
    });
  });

  describe('Field filters', () => {
    it('Should parse multiple field filters correctly', () => {
      const test1 = parser({ args: ['album:"Test Album"', 'artist:TestArtist'], config, utils });
      const filters = { include: { album: 'Test Album', artist: 'TestArtist' } };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse multiple field negation filters correctly', () => {
      const test1 = parser({ args: ['~album:TestAlbum', '~artist:"Test Artist"'], config, utils });
      const filters = { exclude: { album: 'TestAlbum', artist: 'Test Artist' } };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse multiple field array filters correctly', () => {
      const args = ['CustomField1:Cf1,Cf2', 'CustomField2:"CF Value 1, CF Value 2"'];
      const test1 = parser({ args, config, utils });
      const filters = {
        include: { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['CF Value 1', 'CF Value 2'] }
      };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse multiple field array negation filters correctly', () => {
      const args = ['~CustomField1:Cf1,Cf2', '~CustomField2:"CF Value 1, CF Value 2"'];
      const test1 = parser({ args, config, utils });
      const filters = {
        exclude: { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['CF Value 1', 'CF Value 2'] }
      };
      expect(test1.options.filters).to.deep.include(filters);
    });
  });

  describe('Field assignments', () => {
    it('Should parse multiple field assignments correctly', () => {
      const test1 = parser({ args: ['album="Test Album"', 'artist=TestArtist'], config, utils });
      const assignments = { album: 'Test Album', artist: 'TestArtist' };
      expect(test1.options.assignments).to.deep.include(assignments);
    });

    it('Should parse custom TXXX field assignments correctly', () => {
      const test1 = parser({ args: ['CustomField3="Test Custom Value"', 'artist=TestArtist'], config, utils });
      const assignments = { CustomField3: 'Test Custom Value', artist: 'TestArtist' };
      expect(test1.options.assignments).to.deep.include(assignments);
    });

    it('Should parse multiple field array assignments correctly', () => {
      const args = ['CustomField1=Cf1,Cf2', 'CustomField2="CF Value 1, CF Value 2"'];
      const test1 = parser({ args, config, utils });
      const assignments = { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['CF Value 1', 'CF Value 2'] };
      expect(test1.options.assignments).to.deep.include(assignments);
    });
  });
});
