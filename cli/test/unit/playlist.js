const path = require('path');
const playlistFunc = require('../../lib/commands/playlist').func;
const initUtils = require('../../lib/utils/');

module.exports = () => {
  describe('Playlist Command', () => {
    const fileTarget = path.join(process.cwd(), 'test/data/sandbox/testFile.mp3');
    const dirTarget = path.join(process.cwd(), 'test/data/sandbox/dir1');
    const config = {
      rating: { tag: 'POPM', max: 5 },
      tags: [
        {
          name: 'artist',
          id: 'TPE1',
          viewIndex: 1
        },
        {
          name: 'title',
          id: 'TIT2',
          viewIndex: 2
        },
        {
          name: 'album',
          id: 'TALB',
          viewIndex: 3
        },
        {
          name: 'context',
          id: 'TXXX.Context',
          viewIndex: 4,
          multi: true
        }
      ]
    };

    const utils = initUtils(config);

    describe('Command Options and Config', () => {
      it('Should list all files recursively if -r switch provided', async () => {
        const options = '-r';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(7);
      });

      it('Should list all files recursively if config recursive flag is set', async () => {
        const newConfig = { ...config, recursive: true };
        const results = await playlistFunc({ target: dirTarget, config: newConfig, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(7);
      });

      it('Should only list files in current directory if -nr switch provided', async () => {
        const options = '-nr';
        const newConfig = { ...config, recursive: true };
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(5);
      });
    });

    describe('Filters', () => {
      it('Should only include files that match provided field filter string', async () => {
        const options = '-r album:"Unsorted Singles"';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(5);
      });

      it('Should include files that partially match field filter ', async () => {
        const options = '-r artist:"The"';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(3);
      });

      it('Should only include files that intersect field matches for multiple filters', async () => {
        const options = '-r album:"Unsorted Singles" title:Halsey';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(2);
      });

      it('Should include all files that do not match provided negation field filter', async () => {
        const options = '-r ^title:mix';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(5);
      });

      it('Should include all files that intersect non-matches for multiple negation filters', async () => {
        const options = '-r ^title:mix ^album:"Unsorted Singles"';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(3);
      });
      //
      // it('Should only include files that intersect (+) matches and (-) non-matches', () => {});
    });

    // describe('Rating Filters', () => {
    //   it('Should only include files with higher rating if provided with a single number', () => {
    //     expect(true).to.be(true);
    //   });
    //   it('Should only include files that exist within range of provided rating', () => {
    //     expect(true).to.be(true);
    //   });
    // });

    describe('Array Filters', () => {
      it('Should include files that contain array element match', async () => {
        const options = '-r context:Party,Lift"';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(2);
      });

      it('Should only include files that do not contain negated array match elements', async () => {
        const options = '-r ^context:Party,Lift"';
        const results = await playlistFunc({ target: dirTarget, options, config, utils });
        expect(results.split('\n'))
          .be.an('array')
          .of.length(6);
      });
    });
    // it('Should output playlist file to configured directory', () => { });
  });
};
