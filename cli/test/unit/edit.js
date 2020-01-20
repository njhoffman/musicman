const _ = require('lodash');
const path = require('path');
const editFunc = require('../../lib/commands/edit').func;
const initUtils = require('../../lib/utils/');
const { resetSandbox } = require('../utils');

describe('Edit Command', () => {
  const fileTarget = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile02.mp3');
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
        id: 'TXXX.Mood',
        name: 'mood',
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
      const options = 'mood:"Fun,Energetic" poopy:MyPoopyHead title:"Test 1 2 3"';
      const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
      expect(newFiles[0][1].mood).to.equal('Fun,Energetic');
    });

    it('Should add aggregate fields correctly', async () => {
      const options = 'mood:+Relax,+Chill';
      const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
      expect(newFiles[0][1].mood).to.equal('Gloomy,Upbeat,Intense,Relax,Chill');
    });

    it('Should subtract aggregate fields correctly', async () => {
      const options = 'mood:-Upbeat,-Gloomy';
      const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
      expect(newFiles[0][1].mood).to.equal('Intense');
    });
  });

  // describe('File modification', () => {
  //   beforeEach(function() {
  //     resetSandbox();
  //   });
  //
  //   it('Should write field metadata that exists in config.tags', async () => {
  //     const options = 'mood:+Energetic,-Gloomy rating:4.0';
  //     const { newFiles } = await editFunc({ target: fileTarget, options, config, utils });
  //     expect(newFiles[0][1].mood).to.equal('Upbeat,Intense,Energetic');
  //     expect(newFiles[0][1].rating).to.equal('4.0');
  //   });
  //
  //   it('Should not write metadata fields that do not exist in config.tags', async () => {
  //     const newConfig = { ...config, tags: _.initial(config.tags) };
  //     const options = 'rating:3.0 album:"Shouldnot Save"';
  //     const { newFiles } = await editFunc({ target: fileTarget, options, config: newConfig, utils });
  //     expect(newFiles[0][1].album).to.not.equal('Shouldnot Save');
  //     expect(newFiles[0][1].rating).to.equal('3.0');
  //   });
  //   //
  //   //   it('Should assign field metadta of all files given in target directory', () => {
  //   //   });
  //   //
  //   //   it('Should save rating with calculated number based on config.rating max', () => {
  //   //   });
  // });
});
