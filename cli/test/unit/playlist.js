const path = require('path');
const viewFunc = require('../../lib/commands/view').func;

module.exports = () => {
  describe('View Command', () => {
    const fileTarget = path.join(process.cwd(), 'test/data/testFile.mp3');
    const dirTarget = path.join(process.cwd(), 'test/data/dir1');
    const config = {
      tags: [
        { name: 'artist', viewIndex: 1 },
        { name: 'album', viewIndex: 2 }
      ]
    };

    it('Should return vertical output if only one file being viewed', async () => {
      const results = await viewFunc({ target: fileTarget, config });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(4);
    });

    it('Should return vertical list of files if more than one being viewed', async () => {
      const results = await viewFunc({ target: dirTarget, config });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(5);
    });

    // describe('Configuration behavior', () => {
    //   it('Should recursively index directory if set in config', () => {
    //     expect(true).to.equal(true);
    //   });
    //
    //   it('Should only index target directory if set to false in config', () => {
    //     expect(true).to.equal(true);
    //   });
    //
    //   it('Should only list tag fields referenced in config', () => {
    //     expect(true).to.equal(true);
    //   });
    // });
    //
    // describe('Command line behavior', () => {
    //   it('Should recursively index target directory if provided -r switch argument', () => {
    //     expect(true).to.equal(true);
    //   });
    //
    //   it('Should only index target directory if provided -nr switch argument', () => {
    //     expect(true).to.equal(true);
    //   });
    //
    //   it('Should exclude tag fieldslisted with -x switch', () => {
    //     expect(true).to.equal(true);
    //   });
    //
    //   it('Should return vertical format if "-f vertical" argument provided', () => {
    //     expect(true).to.equal(true);
    //   });
    //
    //   it('Should return column format if "-f column" argument provided', () => {
    //     expect(true).to.equal(true);
    //   });
    // });
  });
};
