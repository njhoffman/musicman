const path = require('path');
const playlistFunc = require('../../../lib/commands/playlist').func;
const { resetSandbox, checkFileExists, readFile } = require('../../utils');

describe('Playlist Command', () => {
  const dirTarget = path.join(process.cwd(), 'test/data/sandbox');
  const config = {
    rating: { tag: 'POPM', max: 5 },
    playlist: {
      outputPath: 'test.m3u',
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

  let options = { switches: {}, filters: {}, assignments: {} };
  const playlistPath = path.join(config.playlist.outputDirectory, config.playlist.outputPath);

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
      const newOptions = { ...options, switches: { recursive: false } };
      const results = await playlistFunc({ target: dirTarget, options: newOptions, config });
      expect(results.split('\n'))
        .be.an('array')
        .of.length(11);
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

  describe('Playlist output', () => {
    options = { ...options, switches: { recursive: true } };
    it('Should output playlist file to configured directory', async () => {
      await playlistFunc({ target: dirTarget, options, config });
      const fileExists = await checkFileExists(playlistPath);
      expect(fileExists, playlistPath).to.be.true;
    });

    it('Should append m3u extension if not specified', async () => {
      const newConfig = { ...config, playlist: { ...config.playlist, outputPath: 'test' } };
      await playlistFunc({ target: dirTarget, options, config: newConfig });
      const fileExists = await checkFileExists(playlistPath);
      expect(fileExists, playlistPath).to.be.true;
    });

    it('Should output playlist with list of matching songs', async () => {
      const results = await playlistFunc({ target: dirTarget, options, config });
      const fileContents = await readFile(playlistPath);
      expect(fileContents).to.be.a.string;
      expect(fileContents.trim().split('\n').length).to.equal(16);
    });

    // TODO: make baseDirectory a playlist config option
    it('Should output playlist with correctly resolved paths based on config.mpd.baseDirectory', async () => {
      await playlistFunc({ target: dirTarget, options, config });
      const fileContents = (await readFile(playlistPath)).split('\n');
      expect(fileContents[0]).to.not.contain(process.cwd());
      expect(/^test\/data\/sandbox/.test(fileContents[0])).to.be.true;
    });
    // it('Should throw an error if directory does not exist', async () => {});
    // it('Should throw an error if directory not writeable', async () => {});
    // it('Should prompt for confirmation if playlist will be overwritten', async () => {});
  });
});
