const parser = require('../../../lib/parser');

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

  describe('Switches', () => {
    it('Should parse recursive switches correctly', () => {
      const test1 = parser({ args: ['-r'], config });
      const test2 = parser({ args: ['-nr'], config });
      expect(test1.options.switches).to.include({ recursive: true });
      expect(test2.options.switches).to.include({ recursive: false });
    });

    it('Should parse inclusion output fields switch correctly', () => {
      const test1 = parser({ args: ['-i', 'artist'], config });
      const test2 = parser({ args: ['-i', 'artist,title'], config });
      expect(test1.options.switches).to.deep.include({ include: ['artist'] });
      expect(test2.options.switches).to.deep.include({ include: ['artist', 'title'] });
    });

    it('Should parse exclusion output fields switch correctly', () => {
      const test1 = parser({ args: ['-x', 'artist'], config });
      const test2 = parser({ args: ['-x', 'artist,title'], config });
      expect(test1.options.switches).to.deep.include({ exclude: ['artist'] });
      expect(test2.options.switches).to.deep.include({ exclude: ['artist', 'title'] });
    });
  });

  describe('Field filters', () => {
    it('Should parse field filters correctly', () => {
      const test1 = parser({ args: ['album:"Test Album"', 'artist:TestArtist'], config });
      const filters = { include: { album: 'Test Album', artist: 'TestArtist' } };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse field filters with empty values correctly', () => {
      const test1 = parser({ args: ['album:""', 'artist:'], config });
      const filters = { include: { album: '', artist: '' } };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse field negation filters correctly', () => {
      const test1 = parser({ args: ['~album:TestAlbum', '~artist:"Test Artist"'], config });
      const filters = { exclude: { album: 'TestAlbum', artist: 'Test Artist' } };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse field array filters correctly', () => {
      const args = ['CustomField1:Cf1,Cf2', 'CustomField2:"CF Value 1, CF Value 2"'];
      const test1 = parser({ args, config });
      const filters = {
        include: { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['CF Value 1', 'CF Value 2'] }
      };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse field array negation filters correctly', () => {
      const args = ['~CustomField1:Cf1,Cf2', '~CustomField2:"CF Value 1, CF Value 2"'];
      const test1 = parser({ args, config });
      const filters = {
        exclude: { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['CF Value 1', 'CF Value 2'] }
      };
      expect(test1.options.filters).to.deep.include(filters);
    });
  });

  describe('Field assignments', () => {
    it('Should parse field assignments correctly', () => {
      const test1 = parser({ args: ['album="Test Album"', 'artist=TestArtist'], config });
      const assignments = { album: 'Test Album', artist: 'TestArtist' };
      expect(test1.options.assignments).to.deep.include(assignments);
    });

    it('Should parse field assignments with empty values correctly', () => {
      const test1 = parser({ args: ['album=""', 'artist='], config });
      const assignments = { album: '', artist: '' };
      expect(test1.options.assignments).to.deep.include(assignments);
    });

    it('Should parse TXXX field assignments correctly', () => {
      const test1 = parser({ args: ['CustomField3="Test Custom Value"', 'artist=TestArtist'], config });
      const assignments = { CustomField3: 'Test Custom Value', artist: 'TestArtist' };
      expect(test1.options.assignments).to.deep.include(assignments);
    });

    it('Should parse TXXX field array assignments correctly', () => {
      const args = ['CustomField1=Cf1,Cf2', 'CustomField2="CF Value 1, CF Value 2"'];
      const test1 = parser({ args, config });
      const assignments = { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['CF Value 1', 'CF Value 2'] };
      expect(test1.options.assignments).to.deep.include(assignments);
    });
  });
});
