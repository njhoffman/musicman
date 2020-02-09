const path = require('path');
const editFunc = require('../../../lib/commands/edit').func;
const { resetSandbox } = require('../../utils');

describe('Edit Command', () => {
  const fileTarget = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile02.mp3');
  const fileTarget2 = path.join(process.cwd(), 'test/data/sandbox/dir1/subdir1/testFile03a.mp3');

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
        id: 'TXXX.CustomField',
        name: 'customfield',
        viewIndex: 3
      },
      {
        id: 'TXXX.Mood',
        name: 'mood',
        viewIndex: 4,
        multi: true
      }
    ]
  };

  const options = { switches: {}, filters: {}, assignments: {} };

  describe('Field assignment', () => {
    beforeEach(function() {
      resetSandbox();
    });

    it('Should assign rating field correctly', async () => {
      const newOptions = { ...options, assignments: { rating: '4.5' } };
      const { newFiles } = await editFunc({ target: dirTarget, options: newOptions, config });
      newFiles.forEach(nf => {
        expect(nf[1].rating).to.equal('4.5');
      });
    });

    it('Should assign TXXX fields correctly', async () => {
      const assignments = { customfield: 'testing assignment' };
      const newOptions = { ...options, assignments };
      const { newFiles } = await editFunc({ target: dirTarget, options: newOptions, config });
      newFiles.forEach(nf => {
        expect(nf[1].customfield).to.equal('testing assignment');
      });
    });

    it('Should assign TXXX multi fields correctly', async () => {
      const assignments = { mood: ['Fun', 'Energetic'] };
      const newOptions = { ...options, assignments };
      const { newFiles } = await editFunc({ target: dirTarget, options: newOptions, config });
      newFiles.forEach(nf => {
        expect(nf[1].mood).to.deep.equal(['Fun', 'Energetic']);
      });
    });

    it('Should assign added values to existing  multi fields correctly', async () => {
      const assignments = { mood: ['+Relax', '+Chill'] };
      const newOptions = { ...options, assignments };
      const { newFiles } = await editFunc({ target: fileTarget, options: newOptions, config });
      expect(newFiles[0][1].mood).to.deep.equal(['Relax', 'Chill', 'Gloomy', 'Upbeat', 'Intense']);
    });

    it('Should assign added values to non-existing multi fields correctly', async () => {
      const assignments = { mood: ['+Relax', '+Chill'] };
      const newOptions = { ...options, assignments };
      const { newFiles } = await editFunc({ target: fileTarget2, options: newOptions, config });
      expect(newFiles[0][1].mood).to.deep.equal(['Relax', 'Chill']);
    });

    it('Should assign subtracted values to multi fields correctly', async () => {
      const assignments = { mood: ['-Upbeat', '-Gloomy'] };
      const newOptions = { ...options, assignments };
      const { newFiles } = await editFunc({ target: fileTarget, options: newOptions, config });
      expect(newFiles[0][1].mood).to.deep.equal(['Intense']);
    });

    it('Should assign combinations of aggregate multi fields correctly', async () => {
      const assignments = { mood: ['+Test 1', '-Upbeat', '+Test 2', '-Gloomy'] };
      const newOptions = { ...options, assignments };
      const { newFiles } = await editFunc({ target: fileTarget, options: newOptions, config });
      expect(newFiles[0][1].mood).to.deep.equal(['Test 1', 'Test 2', 'Intense']);
    });
  });

  // describe('File modification', () => {
  //   beforeEach(function() {
  //     resetSandbox();
  //   });
  //
  //   it('Should write field metadata that exists in config.tags', async () => {
  //     const options = 'mood:+Energetic,-Gloomy rating:4.0';
  //     const { newFiles } = await editFunc({ target: fileTarget, options, config });
  //     expect(newFiles[0][1].mood).to.equal('Upbeat,Intense,Energetic');
  //     expect(newFiles[0][1].rating).to.equal('4.0');
  //   });
  //
  //   it('Should not write metadata fields that do not exist in config.tags', async () => {
  //     const newConfig = { ...config, tags: _.initial(config.tags) };
  //     const options = 'rating:3.0 album:"Shouldnot Save"';
  //     const { newFiles } = await editFunc({ target: fileTarget, options, config: newConfig });
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
