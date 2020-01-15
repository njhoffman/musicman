const path = require('path');
const parser = require('../../lib/parser');

module.exports = () => {
  describe('Command Parser', async () => {
    it('Should pass the first test', () => {
      expect(true).to.equal(true);
    });

    const testFile = path.join(process.cwd(), 'test/data/testFile.mp3');
    const config = { mpd: { baseDirectory: 'testBaseDir' } };
    const currentSong = { file: 'testDir/testSong.mp3' };

    describe('Target assignment', () => {
      it('Should assign target if last argument is a file or directory that exists', async () => {
        const test1 = parser({ args: [testFile], config, currentSong });
        const test2 = parser({ args: ['additional', 'args', testFile], config });
        expect(test1).to.include({ target: testFile });
        expect(test2).to.include({ target: testFile });
      });

      it('Should assign target to currently playing song if target not provided or does not exists', () => {
        const test1 = parser({ args: [], currentSong, config });
        expect(test1).to.include({ target: `${config.mpd.baseDirectory}/${currentSong.file}` });
      });

      it('Should assign target to current directory if no song playing and last argument is not a valid target', () => {
        const test1 = parser({ args: ['some', 'args', 'notvalidtarget'], config });
        expect(test1).to.include({ target: process.cwd() });
      });
    });

    describe('Command assignment', () => {
      it('Should default to view command if no matching arguments provided', () => {
        const test1 = parser({ args: [], config });
        const test2 = parser({ args: ['no', 'matching', 'command'], config });
        expect(test1.command).to.include({ name: 'view' });
        expect(test2.command).to.include({ name: 'view' });
      });

      it('Should default to edit if first argument is a rating number', () => {
        const test1 = parser({ args: ['4', 'other', 'args'], config });
        const test2 = parser({ args: ['4.5'], config });
        expect(test1.command).to.include({ name: 'edit' });
        expect(test2.command).to.include({ name: 'edit' });
      });
    });
  });
};
