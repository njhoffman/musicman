const path = require('path');
const editFunc = require('../../lib/commands/edit').func;

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

    const dirTarget = path.join(process.cwd(), 'test/data/sandbox/dir1');
    const config = {};

    describe('Options parsing', () => {
      // it('Should show usage information and exit if no options are given', () => {
      //   expect(true).to.equal(true);
      // });

      it('Should assign unlabeled first argument as rating if numeric', () => {
        editFunc({ target: dirTarget, options: ['4.5'], config });
      });
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
