const _ = require('lodash');
const path = require('path');
const viewFunc = require('../../../lib/commands/view').func;
const initUtils = require('../../../lib/utils/');
const { resetSandbox } = require('../../utils');

describe('View Command', () => {
  let utils;

  const fileTarget = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile01.mp3');
  const dirTarget = path.join(process.cwd(), 'test/data/sandbox');
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

  const options = { switches: {}, filters: {}, assignments: {} };

  beforeEach(function() {
    utils = initUtils(config);
    resetSandbox();
  });

  it('Should return vertical output if only one file being viewed', async () => {
    const results = await viewFunc({ target: fileTarget, options, config, utils });
    expect(results.split('\n'))
      .be.an('array')
      .of.length(6);
  });

  it('Should return vertical list of files if more than one being viewed', async () => {
    const results = await viewFunc({ target: dirTarget, options, config, utils });
    expect(results.split('\n'))
      .to.be.an('array')
      .of.length(11);
  });

  describe('Configuration behavior', () => {
    it('Should recursively index target directory if set in config', async () => {
      config.recursive = true;
      const results = await viewFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(17);
    });

    it('Should only index target directory if not set in config', async () => {
      config.recursive = false;
      const results = await viewFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(11);
    });

    it('Should only list tag fields referenced in config', async () => {
      const newConfig = { ...config, tags: _.initial(config.tags) };
      const results = await viewFunc({ target: fileTarget, config: newConfig, options, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(5);
    });
    //
    // it('It should list rating number based on max number defined in config.rating', () => {
    //   expect(true).to.equal(true);
    // });
  });

  describe('Switches', () => {
    beforeEach(function() {
      utils = initUtils(config);
      resetSandbox();
    });

    it('Should recursively index target directory if recursive switch provided', async () => {
      const newOptions = { ...options, switches: { recursive: true } };
      const results = await viewFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(17);
    });

    it('Should only index target directory if provided non-recursive switch provided', async () => {
      const newOptions = { ...options, switches: { recursive: false } };
      const results = await viewFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(11);
    });

    it('Should exclude fields listed with -x switch', async () => {
      const newOptions = { ...options, switches: { exclude: ['artist'] } };
      const results = await viewFunc({ target: fileTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(5);
    });

    it('Should only show fields specified with -i switch', async () => {
      const newOptions = { ...options, switches: { include: ['artist', 'title'] } };
      const results = await viewFunc({ target: fileTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .to.be.an('array')
        .of.length(4);
    });
    // it('Should return vertical format if "-f vertical" argument provided', () => {
    //   expect(true).to.equal(true);
    // });
    // it('Should return column format if "-f column" argument provided', () => {
    //   expect(true).to.equal(true);
    // });
  });

  describe('Rating Filters', () => {
    it('Should only include files with higher rating if single number provided', async () => {
      const newConfig = { ...config, recursive: true };
      const newOptions = { ...options, filters: { rating: { min: 3.5 } } };
      const results = await viewFunc({ target: dirTarget, options: newOptions, config: newConfig, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(9);

      newOptions.filters.rating.min = 4.5;
      const results2 = await viewFunc({ target: dirTarget, options: newOptions, config: newConfig, utils });
      expect(results2.split('\n'))
        .be.an('array')
        .of.length(5);
    });

    it('Should only include files that do not match negation rating single number', async () => {
      const newConfig = { ...config, recursive: true };
      const newOptions = { ...options, filters: { rating: { min: 3.0, exclude: true } } };
      const results = await viewFunc({ target: dirTarget, options: newOptions, config: newConfig, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(7);
    });

    it('Should only include files that do not match negation rating range number', async () => {
      const newConfig = { ...config, recursive: true };
      const newOptions = { ...options, filters: { rating: { min: 3.0, max: 4.5, exclude: true } } };
      const results = await viewFunc({ target: dirTarget, options: newOptions, config: newConfig, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(9);
    });

    it('Should only include files that do not match rating range number', async () => {
      const newConfig = { ...config, recursive: true };
      const newOptions = { ...options, filters: { rating: { min: 4.0, max: 5.0 } } };
      const results = await viewFunc({ target: dirTarget, options: newOptions, config: newConfig, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(7);
    });
  });
});
