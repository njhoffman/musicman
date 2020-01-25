const path = require('path');
const playlistFunc = require('../../../lib/commands/playlist').func;
const { resetSandbox } = require('../../utils');

describe('Playlist Command', () => {
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

  const options = { switches: {}, filters: {}, assignments: {} };

  beforeEach(function() {
    resetSandbox();
  });

  describe('Switches', () => {
    it('Should list all files recursively if recursive switch (-r) provided or set in config', async () => {
      const newOptions = { ...options, switches: { recursive: true } };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(17);

      const newConfig = { ...config, recursive: true };
      const results2 = await playlistFunc({ target: dirTarget, options, config: newConfig });
      expect(results2.split('\n'))
        .be.an('array')
        .of.length(17);
    });

    it('Should only list files in current directory if non-recursive switch (-nr) provided', async () => {
      const newOptions = { ...options, switches: { recursive: true } };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(17);
    });
  });

  // describe('Filters', () => {
  //   it('Should filter on normal fields corectly', () => {});
  //   it('Should filter on array fields corectly', () => {});
  //   it('Should filter on rating fields corectly', () => {});
  //   it('Should only include files that match provided field filter string', async () => {
  //   const filters = { include: { album: 'Albums!!' } };
  //   const newOptions = { ...options, switches: { recursive: true }, filters };
  //   const results = await playlistFunc({ target: dirTarget, options: newOptions, config });
  //   expect(results.split('\n'))
  //     .be.an('array')
  //     .of.length(5);
  //   })
  // });

  // it('Should output playlist file to configured directory', async () => {
  //   const options = '-r';
  //   const results = await playlistFunc({ target: dirTarget, options, config });
  //   expect(results.split('\n'))
  //     .be.an('array')
  //     .of.length(17);
  // });

  // it('Should output playlist with correctly resolved paths based on config.mpd.baseDirectory', () => { });
});
