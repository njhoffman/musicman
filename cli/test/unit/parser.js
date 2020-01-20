const path = require('path');
const parser = require('../../lib/parser');
const initUtils = require('../../lib/utils/');

describe('Command Parser', async () => {
  it('Should pass the first test', () => {
    expect(true).to.equal(true);
  });

  const testFile = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile01.mp3');

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
      }
    ]
  };
  const currentSong = { file: 'testDir/testSong.mp3' };

  const utils = initUtils(config);

  describe('Target assignment', () => {
    it('Should assign target if argument is a file or directory that exists', async () => {
      const test1 = parser({ args: [testFile], config, currentSong, utils });
      const test2 = parser({ args: ['additional', testFile, 'args'], config, utils });
      expect(test1).to.include({ target: testFile });
      expect(test2).to.include({ target: testFile });
    });

    it('Should assign target to currently playing song if target not provided or does not exists', () => {
      const test1 = parser({ args: [], currentSong, config, utils });
      expect(test1).to.include({ target: `${config.mpd.baseDirectory}/${currentSong.file}` });
    });

    it('Should assign target to current directory if no song playing and last argument is not a valid target', () => {
      const test1 = parser({ args: ['some', 'args', 'notvalidtarget'], config, utils });
      expect(test1).to.include({ target: process.cwd() });
    });
  });

  describe('Command assignment', () => {
    it('Should default to view command if no matching arguments provided', () => {
      const test1 = parser({ args: [], config, utils });
      const test2 = parser({ args: ['no', 'matching', 'command'], config, utils });
      expect(test1.command).to.include({ name: 'view' });
      expect(test2.command).to.include({ name: 'view' });
    });

    it('Should default to edit if first argument is a rating number', () => {
      const test1 = parser({ args: ['4', 'other', 'args'], config, utils });
      const test2 = parser({ args: ['4.5'], config, utils });
      expect(test1.command).to.include({ name: 'edit' });
      expect(test2.command).to.include({ name: 'edit' });
    });
  });

  describe('Options assignment', () => {
    describe('Switches', () => {
      it('Should parse recursive switches correctly', () => {
        const test1 = parser({ args: ['-r'], config, utils });
        const test2 = parser({ args: ['-nr'], config, utils });
        expect(test1.options.switches).to.include({ recursive: true });
        expect(test2.options.switches).to.include({ recursive: false });
      });

      it('Should parse inclusion output fields switch correctly', () => {
        const test1 = parser({ args: ['-i artist'], config, utils });
        const test2 = parser({ args: ['-i artist,title'], config, utils });
        expect(test1.options.switches).to.deep.include({ include: ['artist'] });
        expect(test2.options.switches).to.deep.include({ include: ['artist', 'title'] });
      });

      it('Should parse exclusion output fields switch correctly', () => {
        const test1 = parser({ args: ['-x artist'], config, utils });
        const test2 = parser({ args: ['-x artist,title'], config, utils });
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
        const test1 = parser({ args: ['~album:TestAlbum ~artist:"Test Artist"'], config, utils });
        const filters = { exclude: { album: 'TestAlbum', artist: 'Test Artist' } };
        expect(test1.options.filters).to.deep.include(filters);
      });

      it('Should parse multiple field array filters correctly', () => {
        const args = ['CustomField1:Cf1,Cf2', 'CustomField2:"Custom Field 3, Custom Field 4"'];
        const test1 = parser({ args, config, utils });
        const filters = {
          include: { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['Custom Field 3', 'Custom Field 4'] }
        };
        expect(test1.options.filters).to.deep.include(filters);
      });

      it('Should parse multiple field array negation filters correctly', () => {
        const args = ['~CustomField1:Cf1,Cf2', '~CustomField2:"Custom Field 3, Custom Field 4"'];
        const test1 = parser({ args, config, utils });
        const filters = {
          exclude: { CustomField1: ['Cf1', 'Cf2'], CustomField2: ['Custom Field 3', 'Custom Field 4'] }
        };
        expect(test1.options.filters).to.deep.include(filters);
      });
    });

    describe('Field assignments', () => {});
  });
});
