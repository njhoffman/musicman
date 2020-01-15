const path = require('path');
const {
  func: editFunc,
  _test: { parseOptions }
} = require('../../lib/commands/edit');

module.exports = () => {
  describe('Edit Command', () => {
    // const fileTarget = path.join(process.cwd(), 'test/data/testFile.mp3');
    // const dirTarget = path.join(process.cwd(), 'test/data/dir1');
    // const config = {
    //   tags: [
    //     { name: 'artist', viewIndex: 1 },
    //     { name: 'album', viewIndex: 2 }
    //   ]
    // };

    describe('Options parsing', () => {
      it('Should show usage information and exit if no options are given', () => {
        expect(true).to.equal(true);
      });

      // it('Should assign unlabeled first argument as rating if numeric', () => {
      //   expect(true).to.equal(true);
      // });
      //
      // it('Should parse direct field options correctly', () => {
      //   expect(true).to.equal(true);
      // });
      //
      // it('Should add aggregate fields correctly', () => {
      //   expect(true).to.equal(true);
      // });
      //
      // it('Should subtract aggregate fields correctly', () => {
      //   expect(true).to.equal(true);
      // });
    });

    // describe('File modification', () => {
    //   it('Should write field metadata that exists in config.tags', () => {
    //   });
    //
    //   it('Should not write metadata fields that do not exist in config.tags', () => {
    //   });
    //
    //   it('Should assign field metadta of all files given in target directory', () => {
    //   });
    //
    //   it('Should save rating with calculated number based on config.rating max', () => {
    //   });
    // });
  });
};
