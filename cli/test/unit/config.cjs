const path = require('path');
const fs = require('fs');
const os = require('os');
const proxyquire = require('proxyquire');
const yaml = require('js-yaml');

describe('Config Tests', () => {
  let mockConfig;
  let mockDefaultConfig;
  let mockUserConfig;
  let configModule;
  let validatorModule;

  beforeEach(() => {
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

    // Mock cosmiconfig
    const mockCosmiconfig = {
      search: sinon.stub().returns({
        config: mockUserConfig,
        filepath: '/home/user/.musicmanrc.yml'
      }),
      load: sinon.stub().returns({
        config: mockDefaultConfig,
        filepath: '/path/to/defaultConfig.yml'
      })
    };

    // Mock validator
    validatorModule = {
      initializeConfig: sinon.stub()
    };

    // Setup config module with mocked dependencies
    configModule = proxyquire('../../../common/config/index.js', {
      cosmiconfig: { cosmiconfigSync: () => mockCosmiconfig },
      './tags.json': mockGlobalTags,
      './validator': validatorModule,
      '../../package.json': { name: 'musicman', version: '1.0.0' }
    });
  });

  const loadConfig = (userConfig, defaultConfig = mockDefaultConfig) => {
    const mockCosmiconfig = {
      search: sinon.stub().returns({ config: userConfig, filepath: '/home/user/.musicmanrc.yml' }),
      load: sinon.stub().returns({ config: defaultConfig, filepath: '/path/to/defaultConfig.yml' })
    };
    return proxyquire('../../../common/config/index.js', {
      cosmiconfig: { cosmiconfigSync: () => mockCosmiconfig },
      './tags.json': [
        { id: 'TPE1', name: 'artist' },
        { id: 'TIT2', name: 'title' },
        { id: 'TALB', name: 'album' },
        { id: 'TCON', name: 'genre' }
      ],
      './validator': validatorModule,
      '../../package.json': { name: 'musicman', version: '1.0.0' }
    });
  };

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
      // Create a config with only global tags, no user config override
      const globalOnlyConfig = {};

      const simpleDefaultConfig = {
        library: {
          tags: ['artist', 'title', 'album']
        }
      };

      const mockCosmiconfig = {
        search: sinon.stub().returns({
          config: globalOnlyConfig,
          filepath: '/home/user/.musicmanrc.yml'
        }),
        load: sinon.stub().returns({
          config: simpleDefaultConfig,
          filepath: '/path/to/defaultConfig.yml'
        })
      };

      const testModule = proxyquire('../../../common/config/index.js', {
        cosmiconfig: { cosmiconfigSync: () => mockCosmiconfig },
        './tags.json': [
          { id: 'TPE1', name: 'artist', description: 'Artist' },
          { id: 'TIT2', name: 'title', description: 'Title' },
          { id: 'TALB', name: 'album', description: 'Album' }
        ],
        './validator': validatorModule,
        '../../package.json': { name: 'musicman', version: '1.0.0' }
      });

      expect(testModule.library.tags).to.have.length(3);
      expect(testModule.library.tags.map(t => t.name)).to.deep.equal(['artist', 'title', 'album']);
    });

    it('should throw fatal error for undefined tags', () => {
      // Create config with undefined tag
      const badConfig = {
        library: {
          tags: ['artist', 'nonexistent_tag']
        }
      };

      const mockCosmiconfig = {
        search: sinon.stub().returns({
          config: badConfig,
          filepath: '/home/user/.musicmanrc.yml'
        }),
        load: sinon.stub().returns({
          config: mockDefaultConfig,
          filepath: '/path/to/defaultConfig.yml'
        })
      };

      // Mock process.exit to capture the error
      const originalExit = process.exit;
      let exitCalled = false;
      process.exit = () => {
        exitCalled = true;
      };

      // Mock console.error to capture the error message
      const originalError = console.error;
      let errorMessage = '';
      console.error = msg => {
        errorMessage = errorMessage || msg;
      };

      try {
        proxyquire('../../../common/config/index.js', {
          cosmiconfig: { cosmiconfigSync: () => mockCosmiconfig },
          './tags.json': [{ id: 'TPE1', name: 'artist', description: 'Artist' }],
          './validator': validatorModule,
          '../../package.json': { name: 'musicman', version: '1.0.0' }
        });

        expect(exitCalled).to.be.true;
        expect(errorMessage).to.include(
          "Fatal error: Tag 'nonexistent_tag' defined in library.tags"
        );
      } finally {
        process.exit = originalExit;
        console.error = originalError;
      }
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
      expect(result.messages[0]).to.include('output.table (moved to views.table)');
      expect(result.messages[0]).to.include('output.vertical (moved to views.list)');
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
    it('should call initializeConfig on module load', () => {
      expect(validatorModule.initializeConfig).to.have.been.calledOnce;
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
