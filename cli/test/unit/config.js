const fs = require('fs');
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire');

const loadConfigModule = globalTags =>
  proxyquire('../../../common/config/index.js', {
    './tags.json': globalTags,
    '../../package.json': { name: 'musicman', version: '1.0.0' }
  });

describe('Config Tests', () => {
  let mockDefaultConfig;
  let mockUserConfig;
  let configModule;

  beforeEach(() => {
    // validation warnings for intentionally invalid configs are not test output
    sinon.stub(console, 'warn');

    // Mock default config
    mockDefaultConfig = {
      library: {
        tags: ['artist', 'title', 'year', 'genre', 'album']
      },
      views: {
        table: {
          headers: { visible: true },
          tags: [{ name: 'rating' }, { name: 'artist' }, { name: 'title' }, { name: 'album' }]
        },
        list: {
          headers: { visible: true },
          tags: [{ name: 'rating' }, { name: 'artist' }, { name: 'title' }, { name: 'genre' }]
        }
      },
      rating: {
        tag: 'POPM',
        email: 'Default',
        max: 5
      }
    };

    // Mock user config with custom tags
    mockUserConfig = {
      library: {
        tags: ['artist', 'title', 'year', 'genre', 'album', 'context', 'mood']
      },
      views: {
        table: {
          tags: [{ name: 'artist' }, { name: 'context' }, { name: 'mood' }, { name: 'rating' }]
        }
      },
      tags: [
        { id: 'TPE1', name: 'artist' },
        { id: 'TIT2', name: 'title' },
        { id: 'TALB', name: 'album' },
        { id: 'TCON', name: 'genre' },
        { id: 'TDRL', name: 'year' },
        { id: 'POPM', name: 'rating' },
        { id: 'RVAD', name: 'volume' },
        { id: 'TXXX.Context', name: 'context', multi: true },
        { id: 'TXXX.Mood', name: 'mood', multi: true }
      ]
    };

    // Mock global tags
    const mockGlobalTags = [
      { id: 'TPE1', name: 'artist', description: 'Artist' },
      { id: 'TIT2', name: 'title', description: 'Title' },
      { id: 'TALB', name: 'album', description: 'Album' },
      { id: 'TCON', name: 'genre', description: 'Genre' },
      { id: 'TDRL', name: 'year', description: 'Year' },
      { id: 'POPM', name: 'rating', description: 'Rating' },
      { id: 'RVAD', name: 'volume', description: 'Volume' }
    ];

    configModule = loadConfigModule(mockGlobalTags).loadConfig({
      userConfig: mockUserConfig,
      defaultConfig: mockDefaultConfig
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  const loadConfig = (userConfig, defaultConfig = mockDefaultConfig) =>
    loadConfigModule([
      { id: 'TPE1', name: 'artist' },
      { id: 'TIT2', name: 'title' },
      { id: 'TALB', name: 'album' },
      { id: 'TCON', name: 'genre' }
    ]).loadConfig({ userConfig, defaultConfig });

  const captureFatal = load => {
    const originalExit = process.exit;
    const originalError = console.error;
    const result = { exitCalled: false, messages: [] };
    process.exit = () => {
      result.exitCalled = true;
    };
    console.error = msg => result.messages.push(msg);
    try {
      load();
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
    return result;
  };

  describe('Library Tags Configuration', () => {
    it('should map library.tags to tag objects from user config first', () => {
      expect(configModule.library.tags).to.be.an('array');
      expect(configModule.library.tags).to.have.length(7);

      // Check that custom tags are included
      const tagNames = configModule.library.tags.map(tag => tag.name);
      expect(tagNames).to.include('context');
      expect(tagNames).to.include('mood');
      expect(tagNames).to.include('artist');
      expect(tagNames).to.include('title');
    });

    it('should fallback to global tags when tag not found in user config', () => {
      const config = loadConfig({}, { library: { tags: ['artist', 'title', 'album'] } });
      expect(config.library.tags.map(t => t.name)).to.deep.equal(['artist', 'title', 'album']);
    });

    it('should throw fatal error for undefined tags', () => {
      const result = captureFatal(() => loadConfig({ library: { tags: ['artist', 'nonexistent_tag'] } }));
      expect(result.exitCalled).to.be.true;
      expect(result.messages[0]).to.include(
        "Fatal error: Tag 'nonexistent_tag' defined in library.tags"
      );
    });

    it('should accept text and custom text frames in library.tags', () => {
      const result = captureFatal(() =>
        loadConfig({
          tags: [{ id: 'TXXX.Mood', name: 'mood' }],
          library: { tags: ['artist', 'mood'] },
          views: { table: { tags: [{ name: 'mood' }] }, list: { tags: [{ name: 'artist' }] } }
        })
      );
      expect(result.exitCalled).to.be.false;
    });

    it('should throw fatal error for non-text frames in library.tags', () => {
      const result = captureFatal(() =>
        loadConfig({
          tags: [{ id: 'POPM', name: 'popularity' }],
          library: { tags: ['artist', 'popularity'] },
          views: { table: { tags: [{ name: 'artist' }] }, list: { tags: [{ name: 'artist' }] } }
        })
      );
      expect(result.exitCalled).to.be.true;
      expect(result.messages[0]).to.include(
        "Fatal error: Tag 'popularity' in library.tags uses frame 'POPM'"
      );
    });

    it('should throw fatal error for bare TXXX frame in library.tags', () => {
      const result = captureFatal(() =>
        loadConfig({
          tags: [{ id: 'TXXX', name: 'user_text' }],
          library: { tags: ['user_text'] },
          views: { table: { tags: [] }, list: { tags: [] } }
        })
      );
      expect(result.exitCalled).to.be.true;
      expect(result.messages[0]).to.include("uses frame 'TXXX'");
    });

    it('should throw fatal error for library.tags sharing a frame', () => {
      const result = captureFatal(() =>
        loadConfig({
          tags: [{ id: 'TPE1', name: 'performer' }],
          library: { tags: ['artist', 'performer'] },
          views: { table: { tags: [] }, list: { tags: [] } }
        })
      );
      expect(result.exitCalled).to.be.true;
      expect(result.messages[0]).to.include(
        "Fatal error: Tags 'artist', 'performer' in library.tags share frame 'TPE1'"
      );
    });
  });

  describe('Views Configuration', () => {
    it('should have table and list views with tags', () => {
      expect(configModule.views).to.have.all.keys('table', 'list');
      expect(configModule.views.table.tags).to.be.an('array');
      expect(configModule.views.list.tags).to.be.an('array');
    });

    it('should replace default view tags with user view tags', () => {
      expect(configModule.views.table.tags.map(t => t.name)).to.deep.equal([
        'artist',
        'context',
        'mood',
        'rating'
      ]);
    });

    it('should keep default view settings not overridden by user', () => {
      expect(configModule.views.table.headers).to.deep.equal({ visible: true });
      expect(configModule.views.list).to.deep.equal(mockDefaultConfig.views.list);
    });

    it('should not merge shorter user arrays with default arrays by index', () => {
      const config = loadConfig({
        library: { tags: ['artist'] },
        views: { table: { tags: [{ name: 'artist' }] }, list: { tags: [{ name: 'artist' }] } }
      });
      expect(config.library.tags.map(t => t.name)).to.deep.equal(['artist']);
      expect(config.views.list.tags).to.deep.equal([{ name: 'artist' }]);
    });

    it('should allow rating in views without being in library.tags', () => {
      const result = captureFatal(() =>
        loadConfig({
          library: { tags: ['artist'] },
          views: { table: { tags: [{ name: 'rating' }] }, list: { tags: [{ name: 'rating' }] } }
        })
      );
      expect(result.exitCalled).to.be.false;
    });

    it('should throw fatal error for view tags not in library.tags', () => {
      const result = captureFatal(() =>
        loadConfig({
          library: { tags: ['artist'] },
          views: { table: { tags: [{ name: 'artist' }] }, list: { tags: [{ name: 'title' }] } }
        })
      );
      expect(result.exitCalled).to.be.true;
      expect(result.messages[0]).to.include(
        "Fatal error: Tag 'title' defined in views.list.tags but not found in library.tags"
      );
    });

    it('should throw fatal error for outdated output.table and output.vertical options', () => {
      const result = captureFatal(() =>
        loadConfig({ output: { table: { color: '#FFFFFF' }, vertical: { color: '#FFFFFF' } } })
      );
      expect(result.exitCalled).to.be.true;
      const output = result.messages.join('\n');
      expect(output).to.include('output.table is no longer supported (moved to views.table)');
      expect(output).to.include('output.vertical is no longer supported (moved to views.list)');
    });

    it('should throw fatal error for outdated tags[].tableOrder option', () => {
      const result = captureFatal(() =>
        loadConfig({ tags: [{ id: 'TPE1', name: 'artist', tableOrder: 1 }] })
      );
      expect(result.exitCalled).to.be.true;
      expect(result.messages[0]).to.include('tags[].tableOrder');
    });
  });

  describe('Config Initialization', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-config-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should not read or create config files when required', () => {
      const existsSync = sinon.spy(fs, 'existsSync');
      const copyFileSync = sinon.spy(fs, 'copyFileSync');
      loadConfigModule([]);
      expect(existsSync).to.not.have.been.called;
      expect(copyFileSync).to.not.have.been.called;
    });

    it('should use ~/.musicmanrc.yml as the user config path', () => {
      const { getUserConfigPath } = require('../../../common/config/validator.js');
      expect(getUserConfigPath()).to.equal(path.join(os.homedir(), '.musicmanrc.yml'));
    });

    it('should load the user config from the given path', () => {
      const userConfigPath = path.join(tmpDir, '.musicmanrc.yml');
      fs.writeFileSync(userConfigPath, 'rating:\n  email: test@example.com\n');
      const config = loadConfigModule([]).loadConfig({
        userConfigPath,
        defaultConfig: { ...mockDefaultConfig, library: { tags: [] }, views: {} }
      });
      expect(config.rating.email).to.equal('test@example.com');
      expect(config.rating.tag).to.equal('POPM');
    });

    it('should use defaults without creating a file when user config is missing', () => {
      const userConfigPath = path.join(tmpDir, '.musicmanrc.yml');
      const config = loadConfigModule([]).loadConfig({
        userConfigPath,
        defaultConfig: { ...mockDefaultConfig, library: { tags: [] }, views: {} }
      });
      expect(config.rating.email).to.equal('Default');
      expect(fs.existsSync(userConfigPath)).to.be.false;
    });

    it('should create the user config from defaults when create is set', () => {
      const userConfigPath = path.join(tmpDir, '.musicmanrc.yml');
      sinon.stub(console, 'log');
      loadConfigModule([]).loadConfig({
        userConfigPath,
        create: true,
        defaultConfig: { ...mockDefaultConfig, library: { tags: [] }, views: {} }
      });
      expect(fs.readFileSync(userConfigPath, 'utf8')).to.equal(
        fs.readFileSync(path.join(__dirname, '../../../common/config/defaultConfig.yml'), 'utf8')
      );
    });

    it('should warn about validation issues in the loaded user config', () => {
      loadConfig({ unknownOption: true });
      expect(console.warn).to.have.been.calledWithMatch('1 configuration warnings');
      expect(console.warn).to.have.been.calledWithMatch('unknownOption is not a valid configuration option');
    });

    it('should map year to the ID3v2.3 TYER frame by default', () => {
      const { loadConfig: loadRealConfig } = require('../../../common/config/index.js');
      const config = loadRealConfig({ userConfig: {} });
      expect(config.library.tags.find(tag => tag.name === 'year').id).to.equal('TYER');
    });

    it('should not exit for unknown options', () => {
      const result = captureFatal(() => loadConfig({ unknownOption: true }));
      expect(result.exitCalled).to.be.false;
    });

    it('should treat wrong types and out of range values as fatal errors', () => {
      const result = captureFatal(() => loadConfig({ mpd: { port: 'abc' }, output: { verbosity: 9 } }));
      expect(result.exitCalled).to.be.true;
      const output = result.messages.join('\n');
      expect(output).to.include('mpd.port must be a number');
      expect(output).to.include('output.verbosity must be <= 6');
    });

    it('should report every error before exiting', () => {
      const result = captureFatal(() =>
        loadConfig({ mpd: { port: 'abc' }, library: { tags: ['artist', 'nonexistent_tag'] } })
      );
      const fatalMessages = result.messages.filter(msg => msg.startsWith('Fatal error:'));
      expect(fatalMessages).to.include('Fatal error: mpd.port must be a number');
      expect(fatalMessages).to.include(
        "Fatal error: Tag 'nonexistent_tag' defined in library.tags but not found in user tags or global tags.json"
      );
    });

    it('should return errors and warnings from checkConfig without exiting', () => {
      const result = captureFatal(() => {
        const { checkConfig } = loadConfigModule([{ id: 'TPE1', name: 'artist' }]);
        const checked = checkConfig({
          userConfig: { unknownOption: true, library: { tags: ['artist', 'nonexistent_tag'] } },
          defaultConfig: mockDefaultConfig
        });
        expect(checked.warnings).to.deep.equal(['unknownOption is not a valid configuration option']);
        expect(checked.errors[0]).to.include("Tag 'nonexistent_tag' defined in library.tags");
      });
      expect(result.exitCalled).to.be.false;
    });

    it('should default database files to the mpd base directory', () => {
      const { loadConfig: loadRealConfig } = require('../../../common/config/index.js');
      const config = loadRealConfig({ userConfig: { mpd: { baseDirectory: '/music' } } });
      expect(config.db.path).to.equal('/music/musicman.sqlite');
      expect(config.db.backupDirectory).to.equal('/music/.musicman');
      expect(config.db.backupInterval).to.equal('1 day');
    });

    it('should resolve a relative log file name in the mpd base directory', () => {
      const { loadConfig: loadRealConfig } = require('../../../common/config/index.js');
      expect(loadRealConfig({ userConfig: { mpd: { baseDirectory: '/music' } } }).logger.file).to.deep.equal({
        name: '/music/musicman.log',
        level: 5
      });
      const absolute = loadRealConfig({ userConfig: { logger: { file: { name: '/var/log/mm.log' } } } });
      expect(absolute.logger.file.name).to.equal('/var/log/mm.log');
    });

    it('should expand ~ in configured database paths', () => {
      const { loadConfig: loadRealConfig } = require('../../../common/config/index.js');
      const config = loadRealConfig({
        userConfig: { db: { path: '~/music.sqlite', backupDirectory: '/backups' } }
      });
      expect(config.db.path).to.equal(path.join(os.homedir(), 'music.sqlite'));
      expect(config.db.backupDirectory).to.equal('/backups');
    });

    it('should treat an invalid backup interval as a fatal error', () => {
      const result = captureFatal(() => loadConfig({ db: { backupInterval: 'often' } }));
      expect(result.exitCalled).to.be.true;
      expect(result.messages.join('\n')).to.include("db.backupInterval 'often' must be a number of");
    });

    it('should require at least one backup to keep', () => {
      const result = captureFatal(() => loadConfig({ db: { backupCount: 0 } }));
      expect(result.exitCalled).to.be.true;
      expect(result.messages.join('\n')).to.include('db.backupCount must be >= 1');
    });

    it('should validate sync playlist mappings', () => {
      const result = captureFatal(() =>
        loadConfig({
          sync: {
            playlists: [
              { filter: 'grouping:Rock', playlist: 'https://open.spotify.com/playlist/5MUDXMSHkjbA2CIYXjj1Vz?si=a1' },
              { filter: 'mood:Happy' },
              { filter: 'mood:Sad', playlist: 'not a playlist' }
            ]
          }
        })
      );
      const output = result.messages.join('\n');
      expect(output).to.include('sync.playlists[1] must have a filter and a playlist');
      expect(output).to.include("sync.playlists[2].playlist 'not a playlist' is not a Spotify playlist URL or id");
      expect(output).to.not.include('sync.playlists[0]');
    });

    it('should parse Spotify playlist URLs, URIs, and ids', () => {
      const { parsePlaylistId } = require('../../../common/config/validator.js');
      const id = '5MUDXMSHkjbA2CIYXjj1Vz';
      expect(parsePlaylistId(`https://open.spotify.com/playlist/${id}?si=a9900a672c9c4839`)).to.equal(id);
      expect(parsePlaylistId(`spotify:playlist:${id}`)).to.equal(id);
      expect(parsePlaylistId(id)).to.equal(id);
      expect(parsePlaylistId('https://open.spotify.com/album/x')).to.be.null;
    });

    it('should default sync directories to .musicman in the mpd base directory', () => {
      const { loadConfig: loadRealConfig } = require('../../../common/config/index.js');
      const config = loadRealConfig({ userConfig: { mpd: { baseDirectory: '/music' } } });
      expect(config.sync).to.include({
        likedRating: 4.5,
        uploadDirectory: '/music/.musicman/upload',
        downloadDirectory: '/music/.musicman/download',
        beetsConfig: path.join(os.homedir(), '.config/beets/config.yaml')
      });
    });

    it('should parse backup intervals', () => {
      const { parseInterval } = require('../../../common/config/validator.js');
      expect(parseInterval('1 day')).to.equal(24 * 60 * 60 * 1000);
      expect(parseInterval('12 hours')).to.equal(12 * 60 * 60 * 1000);
      expect(parseInterval('30 minutes')).to.equal(30 * 60 * 1000);
      expect(parseInterval('2 weeks')).to.equal(14 * 24 * 60 * 60 * 1000);
      expect(parseInterval('soon')).to.be.null;
    });

    it('should merge configs with proper precedence', () => {
      expect(configModule.rating.tag).to.equal('POPM');
      expect(configModule.rating.email).to.equal('Default');
      expect(configModule.rating.max).to.equal(5);
    });

    it('should include version and environment', () => {
      expect(configModule.version).to.equal('1.0.0');
      expect(configModule.env).to.be.a('string');
    });
  });
});
