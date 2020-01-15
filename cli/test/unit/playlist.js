const path = require('path');
const viewFunc = require('../../lib/commands/playlist').func;

module.exports = () => {
  describe('Playlist Command', () => {
    const fileTarget = path.join(process.cwd(), 'test/data/testFile.mp3');
    const dirTarget = path.join(process.cwd(), 'test/data/dir1');
    const config = {
      tags: [
        { name: 'artist', viewIndex: 1 },
        { name: 'album', viewIndex: 2 }
      ]
    };

    it('Should pass gas', async () => {
      expect(true).to.equal(true);
    });
  });
};
