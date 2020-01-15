const _ = require('lodash');
const path = require('path');
const editFunc = require('../../lib/commands/edit').func;
const initUtils = require('../../lib/utils/');
const { resetSandbox } = require('../utils');

module.exports = () => {
  describe('Edit Command', () => {
    const fileTarget = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile2.mp3');
    const dirTarget = path.join(process.cwd(), 'test/data/sandbox');
    const config = {
      rating: { tag: 'POPM', max: 5, email: 'noone@email.com' },
      tags: [
        {
          id: 'TPE1',
          name: 'artist',
          viewIndex: 1
        },
        {
          id: 'TIT2',
          name: 'title',
          viewIndex: 2
        },
        {
          id: 'TXXX.Context',
          name: 'context',
          viewIndex: 3,
          multi: true
        }
      ]
    };

    const utils = initUtils(config);

    describe('Options parsing', () => {
      beforeEach(function() {
        resetSandbox();
      });

      it('Should assign unlabeled first argument as rating if numeric', async () => {
        const options = '4.5';
        const { newFiles } = await editFunc({ target: dirTarget, options, config, utils });
        expect(newFiles[0][1].rating).to.equal('4.5');
      });

      it('Should parse direct field options correctly', async () => {
        const options = 'context:"Party,Pool"';
        const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
        expect(newFiles[0][1].context).to.equal('Party,Pool');
      });

      it('Should add aggregate fields correctly', async () => {
        const options = 'context:+Study,+Relax';
        const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
        expect(newFiles[0][1].context).to.equal('Party,Run,Drive,Lift,Code,Study,Relax');
      });

      it('Should subtract aggregate fields correctly', async () => {
        const options = 'context:-Party,-Run';
        const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
        expect(newFiles[0][1].context).to.equal('Drive,Lift,Code');
      });
    });

    describe('File modification', () => {
      beforeEach(function() {
        resetSandbox();
      });

      it('Should write field metadata that exists in config.tags', async () => {
        const options = 'context:+Party,-Run rating:4.0';
        const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
        expect(newFiles[0][1].context).to.equal('Party,Drive,Lift,Code');
        expect(newFiles[0][1].rating).to.equal('4.0');
      });

      it('Should not write metadata fields that do not exist in config.tags', async () => {
        const newConfig = { ...config, tags: _.initial(config.tags) };
        const options = 'rating:3.5 album:"Shouldnot Save"';
        const { newFiles } = await editFunc({ target: fileTarget, options, config: newConfig, utils });
        expect(newFiles[0][1].album).to.not.equal('Shouldnot Save');
        expect(newFiles[0][1].rating).to.equal('3.5');
      });
      //
      //   it('Should assign field metadta of all files given in target directory', () => {
      //   });
      //
      //   it('Should save rating with calculated number based on config.rating max', () => {
      //   });
    });
  });
};
