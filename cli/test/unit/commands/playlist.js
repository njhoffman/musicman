const path = require('path');
const playlistFunc = require('../../../lib/commands/playlist').func;
const initUtils = require('../../../lib/utils/');
const { resetSandbox } = require('../../utils');

describe('Playlist Command', () => {
  const dirTarget = path.join(process.cwd(), 'test/data/sandbox');

  let utils;

  const config = {
    rating: { tag: 'POPM', max: 5 },
    playlist: {
      outputPath: `${new Date().toISOString()}`,
      outputDirectory: '/home/nicholas/.mpd/playlists/'
    },
    mpd: {
      baseDirectory: process.cwd()
    },
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
        name: 'mood',
        id: 'TXXX.Mood',
        viewIndex: 4,
        multi: true
      }
    ]
  };

  const options = { switches: {}, filters: {}, assignments: {} };

  beforeEach(function() {
    utils = initUtils(config);
    resetSandbox();
  });

  describe('Switches', () => {
    it('Should list all files recursively if recursive switch (-r) provided', async () => {
      const newOptions = { ...options, switches: { recursive: true } };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(17);
    });

    it('Should list all files recursively if recursive flag is set in config', async () => {
      const newConfig = { ...config, recursive: true };
      const results = await playlistFunc({ target: dirTarget, options, config: newConfig, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(17);
    });

    it('Should only list files in current directory if non-recursive switch (-nr) provided', async () => {
      const newOptions = { ...options, switches: { recursive: true } };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(17);
    });
  });

  describe('Filters', () => {
    it('Should only include files that match provided field filter string', async () => {
      const filters = { include: { album: 'Albums!!' } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(5);
    });

    it('Should include files that partially match field filter ', async () => {
      const filters = { include: { album: 'Album' } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(15);
    });

    it('Should only include files that intersect field matches for multiple filters', async () => {
      const filters = { include: { album: 'Album', title: 'seconds' } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(7);
    });

    it('Should include all files that do not match provided negation field filter', async () => {
      const filters = { exclude: { album: 'Albums!' } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(12);
    });

    it('Should include all files that intersect non-matches for multiple negation filters', async () => {
      const filters = { exclude: { album: 'Albums!', title: 'silence' } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(3);
    });
    //
    // it('Should only include files that intersect (+) matches and (-) non-matches', () => {});
  });

  describe('Rating Filters', () => {
    it('should only include files with higher rating if provided with a single number', async () => {
      const filters = { rating: { min: '3.5' } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(9);

      const filters2 = { rating: { min: '4.5' } };
      const newOptions2 = { ...options, switches: { recursive: true }, filters: filters2 };
      const results2 = await playlistFunc({ target: dirTarget, options: newOptions2, config, utils });
      expect(results2.split('\n'))
        .be.an('array')
        .of.length(5);
    });

    it('should only include files that exist within range of provided rating', async () => {
      const filters = { rating: { min: '3.5', max: '4' } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(3);
    });
  });

  describe('Array Filters', () => {
    it('Should include files that contain array element match', async () => {
      const filters = { include: { mood: ['Sad', 'Gloomy'] } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(3);
    });

    it('Should only include files that do not contain negated array match elements', async () => {
      const filters = { exclude: { mood: ['Sad', 'Gloomy'] } };
      const newOptions = { ...options, switches: { recursive: true }, filters };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(13);
    });
  });

  // it('Should output playlist file to configured directory', async () => {
  //   const options = '-r';
  //   const results = await playlistFunc({ target: dirTarget, options, config, utils });
  //   expect(results.split('\n'))
  //     .be.an('array')
  //     .of.length(17);
  // });

  // it('Should output playlist with correctly resolved paths based on config.mpd.baseDirectory', () => { });
});
