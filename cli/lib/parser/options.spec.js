const parser = require('./index.js');

describe('Options assignment', () => {
  const config = {
    mpd: { baseDirectory: 'testBaseDir' },
    library: {
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
    }
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

    it('Should parse playlist write switch correctly', () => {
      const test1 = parser({ args: ['-w', 'party'], config });
      expect(test1.options.switches).to.deep.equal({ write: 'party' });
    });

    it('Should parse long form switches by name', () => {
      const test1 = parser({ args: ['--update'], config });
      const test2 = parser({ args: ['--recursive'], config });
      expect(test1.options.switches).to.include({ update: true });
      expect(test2.options.switches).to.include({ recursive: true });
    });

    it('Should parse files switch', () => {
      expect(parser({ args: ['--files'], config }).options.switches).to.include({ files: true });
      expect(parser({ args: ['-f'], config }).options.switches).to.include({ files: true });
    });

    it('Should not treat bare words named like switches as switches', () => {
      const test1 = parser({ args: ['view', 'files', 'recursive'], config });
      expect(test1.options.switches).to.deep.equal({});
    });

    it('Should parse backup switch', () => {
      expect(parser({ args: ['--backup'], config }).options.switches).to.include({ backup: true });
      expect(parser({ args: ['-b'], config }).options.switches).to.include({ backup: true });
    });

    it('Should parse update switch alias', () => {
      const test1 = parser({ args: ['-u'], config });
      expect(test1.options.switches).to.include({ update: true });
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

    it('Should ignore field filters for tags not in library.tags', () => {
      const tagsConfig = { ...config, tags: [{ name: 'genre', id: 'TCON' }] };
      const test1 = parser({ args: ['genre:Rock', 'artist:TestArtist'], config: tagsConfig });
      expect(test1.options.filters.include).to.deep.equal({ artist: 'TestArtist' });
    });

    it('Should parse field filters with empty values correctly', () => {
      const test1 = parser({ args: ['album:""', 'artist:'], config });
      const filters = { include: { album: '', artist: '' } };
      expect(test1.options.filters).to.deep.include(filters);
    });

    it('Should parse empty multi value field filters as empty', () => {
      const test1 = parser({ args: ['CustomField1:', '~CustomField2:'], config });
      expect(test1.options.filters.include).to.deep.equal({ CustomField1: '' });
      expect(test1.options.filters.exclude).to.deep.equal({ CustomField2: '' });
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

    it('Should ignore field assignments for tags not in library.tags', () => {
      const tagsConfig = { ...config, tags: [{ name: 'genre', id: 'TCON' }] };
      const test1 = parser({ args: ['genre=Rock', 'artist=TestArtist'], config: tagsConfig });
      expect(test1.options.assignments).to.deep.equal({ artist: 'TestArtist' });
    });

    it('Should parse field assignments with empty values correctly', () => {
      const test1 = parser({ args: ['album=""', 'artist='], config });
      const assignments = { album: '', artist: '' };
      expect(test1.options.assignments).to.deep.include(assignments);
    });

    it('Should parse TXXX field assignments correctly', () => {
      const test1 = parser({
        args: ['CustomField3="Test Custom Value"', 'artist=TestArtist'],
        config
      });
      const assignments = { CustomField3: 'Test Custom Value', artist: 'TestArtist' };
      expect(test1.options.assignments).to.deep.include(assignments);
    });

    it('Should parse TXXX field array assignments correctly', () => {
      const args = ['CustomField1=Cf1,Cf2', 'CustomField2="CF Value 1, CF Value 2"'];
      const test1 = parser({ args, config });
      const assignments = {
        CustomField1: ['Cf1', 'Cf2'],
        CustomField2: ['CF Value 1', 'CF Value 2']
      };
      expect(test1.options.assignments).to.deep.include(assignments);
    });
  });
});
