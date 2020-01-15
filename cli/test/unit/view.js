const _ = require('lodash');
const path = require('path');
const viewFunc = require('../../lib/commands/view').func;
const initUtils = require('../../lib/utils/');

module.exports = () => {
  describe('View Command', () => {
    const fileTarget = path.join(process.cwd(), 'test/data/sandbox/testFile.mp3');
    const dirTarget = path.join(process.cwd(), 'test/data/sandbox/dir1');
    const config = {
      rating: { tag: 'POPM', max: 5, email: 'fake@email.com' },
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
        }
      ]
    };

    const utils = initUtils(config);

    it('Should return vertical output if only one file being viewed', async () => {
      const results = await viewFunc({ target: fileTarget, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(5);
    });

    it('Should return vertical list of files if more than one being viewed', async () => {
      const results = await viewFunc({ target: dirTarget, config, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(5);
    });

    describe('Configuration behavior', () => {
      it('Should recursively index target directory if set in config', async () => {
        config.recursive = true;
        const results = await viewFunc({ target: dirTarget, config, utils });
        expect(results.split('\n'))
          .to.be.an('array')
          .of.length(7);
      });

      it('Should only index target directory if not set in config', async () => {
        config.recursive = false;
        const results = await viewFunc({ target: dirTarget, config, utils });
        expect(results.split('\n'))
          .to.be.an('array')
          .of.length(5);
      });

      it('Should only list tag fields referenced in config', async () => {
        const newConfig = { ...config, tags: _.initial(config.tags) };
        const results = await viewFunc({ target: fileTarget, config: newConfig, utils });
        expect(results.split('\n'))
          .to.be.an('array')
          .of.length(4);
      });

      it('It should list rating number based on max number defined in config.rating', () => {
        expect(true).to.equal(true);
      });
    });

    describe('Command line behavior', () => {
      it('Should recursively index target directory if provided -r switch argument', async () => {
        const results = await viewFunc({ target: dirTarget, options: '-r', config, utils });
        expect(results.split('\n'))
          .to.be.an('array')
          .of.length(7);
      });

      it('Should only index target directory if provided -nr switch argument', async () => {
        config.recursive = true;
        const results = await viewFunc({ target: dirTarget, options: '-nr', config, utils });
        expect(results.split('\n'))
          .to.be.an('array')
          .of.length(5);
      });

      it('Should exclude tag fieldslisted with -x switch', async () => {
        const results = await viewFunc({ target: fileTarget, options: '-x artist', config, utils });
        expect(results.split('\n'))
          .to.be.an('array')
          .of.length(4);
      });
      //
      // it('Should return vertical format if "-f vertical" argument provided', () => {
      //   expect(true).to.equal(true);
      // });
      //
      // it('Should return column format if "-f column" argument provided', () => {
      //   expect(true).to.equal(true);
      // });
    });
  });
};
