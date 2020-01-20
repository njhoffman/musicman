const path = require('path');
const playlistFunc = require('../../lib/commands/playlist').func;
const initUtils = require('../../lib/utils/');
const { resetSandbox } = require('../utils');

describe('Playlist Command', () => {
  const fileTarget = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile02.mp3');
  const dirTarget = path.join(process.cwd(), 'test/data/sandbox');

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

  const utils = initUtils(config);

  beforeEach(function() {
    resetSandbox();
  });

  describe('Command Options and Config', () => {
    it('Should list all files recursively if -r switch provided', async () => {
      const options = '-r';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(17);
    });

    it('Should list all files recursively if config recursive flag is set', async () => {
      const newConfig = { ...config, recursive: true };
      const results = await playlistFunc({ target: dirTarget, config: newConfig, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(17);
    });

    it('Should only list files in current directory if -nr switch provided', async () => {
      const options = '-nr';
      const newConfig = { ...config, recursive: true };
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(11);
    });
  });

  describe('Filters', () => {
    it('Should only include files that match provided field filter string', async () => {
      const options = '-r album:"Albums!!"';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(5);
    });

    it('Should include files that partially match field filter ', async () => {
      const options = '-r album:"Album"';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(15);
    });

    it('Should only include files that intersect field matches for multiple filters', async () => {
      const options = '-r album:"Album" title:seconds';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(7);
    });

    it('Should include all files that do not match provided negation field filter', async () => {
      const options = '-r ^album:Albums!';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(12);
    });

    it('Should include all files that intersect non-matches for multiple negation filters', async () => {
      const options = '-r ^album:Albums! ^title:"silence"';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(3);
    });

    // it('Should only include files that intersect (+) matches and (-) non-matches', () => {});
  });

  describe('Rating Filters', () => {
    it('should only include files with higher rating if provided with a single number', async () => {
      const options = '-r rating:3.5';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(9);

      const options2 = '-r rating:4.5';
      const results2 = await playlistFunc({ target: dirTarget, options: options2, config, utils });
      expect(results2.split('\n'))
        .be.an('array')
        .of.length(5);
    });

    it('should only include files that exist within range of provided rating', async () => {
      const options = '-r rating:3.5-4';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(3);
    });
  });

  describe('Array Filters', () => {
    it('Should include files that contain array element match', async () => {
      const options = '-r mood:Sad,Gloomy';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(3);
    });

    it('Should only include files that do not contain negated array match elements', async () => {
      const options = '-r ^mood:Upbeat,Gloomy';
      const results = await playlistFunc({ target: dirTarget, options, config, utils });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(11);
    });
  });

  it('Should output playlist file to configured directory', async () => {
    const options = '-r';
    const results = await playlistFunc({ target: dirTarget, options, config, utils });
    expect(results.split('\n'))
      .be.an('array')
      .of.length(17);
  });
});
