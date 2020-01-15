const path = require('path');
const editFunc = require('../../lib/commands/edit').func;
const initUtils = require('../../lib/utils/');

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

    // describe('Options parsing', () => {
    //   it('Should assign unlabeled first argument as rating if numeric', async () => {
    //     const options = ['4.5'];
    //     const results = await editFunc({ target: dirTarget, options, config, utils });
    //     expect(results[0].rating).to.equal(230);
    //   });
    //
    //   it('Should parse direct field options correctly', async () => {
    //     const options = ['context:"Party,Pool"'];
    //     const results = await editFunc({ target: fileTarget, options, config, utils });
    //     expect(results[0].context).to.equal('Party,Pool');
    //   });
    //
    //   it('Should add aggregate fields correctly', async () => {
    //     const options = ['context:+Study,+Relax'];
    //     const results = await editFunc({ target: fileTarget, options, config, utils });
    //     expect(results[0].context).to.equal('Party,Run,Drive,Lift,Code,Study,Relax');
    //   });
    //
    //   it('Should subtract aggregate fields correctly', async () => {
    //     const options = ['context:-Party,-Run'];
    //     const results = await editFunc({ target: fileTarget, options, config, utils });
    //     expect(results[0].context).to.equal('Drive,Lift,Code');
    //   });
    // });

    describe('File modification', () => {
      it('Should write field metadata that exists in config.tags', async () => {
        const options = 'context:+Party,-Run rating:4.0';
        const results = await editFunc({ target: fileTarget, options, config, utils });
        console.log(results);
        // expect(results[0].context).to.equal('Drive,Lift,Code');
      });
      //
      //   it('Should not write metadata fields that do not exist in config.tags', () => {
      //   });
      //
      //   it('Should assign field metadta of all files given in target directory', () => {
      //   });
      //
      //   it('Should save rating with calculated number based on config.rating max', () => {
      //   });
    });
  });
};
