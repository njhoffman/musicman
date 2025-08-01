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
        tags: ['rating', 'volume', 'artist', 'title', 'year', 'genre', 'album']
      },
      views: {
        default: [
          { name: 'artist' },
          { name: 'title' },
          { name: 'album' }
        ],
        edit: [
          { name: 'artist' },
          { name: 'title' },
          { name: 'album' },
          { name: 'rating' }
        ],
        playlist: [
          { name: 'artist' },
          { name: 'title' },
          { name: 'rating' }
        ],
        stats: [
          { name: 'artist' },
          { name: 'title' },
          { name: 'genre' }
        ]
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
        tags: ['rating', 'volume', 'artist', 'title', 'year', 'genre', 'album', 'context', 'mood']
      },
      views: {
        edit: [
          { name: 'artist' },
          { name: 'title' },
          { name: 'album' },
          { name: 'context' },
          { name: 'mood' },
          { name: 'rating' }
        ]
      },
      tags: [
        { id: 'TPE1', name: 'artist', tableOrder: 1 },
        { id: 'TIT2', name: 'title', tableOrder: 2 },
        { id: 'TALB', name: 'album', tableOrder: 3 },
        { id: 'TCON', name: 'genre', tableOrder: 4 },
        { id: 'TDRL', name: 'year', tableOrder: 5 },
        { id: 'POPM', name: 'rating', tableOrder: 6 },
        { id: 'RVAD', name: 'volume', tableOrder: 7 },
        { id: 'TXXX.Context', name: 'context', tableOrder: 8, multi: true },
        { id: 'TXXX.Mood', name: 'mood', tableOrder: 9, multi: true }
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
      'cosmiconfig': { cosmiconfigSync: () => mockCosmiconfig },
      './tags.json': mockGlobalTags,
      './validator': validatorModule,
      '../../package.json': { name: 'musicman', version: '1.0.0' }
    });
  });

  describe('Library Tags Configuration', () => {
    it('should map library.tags to tag objects from user config first', () => {
      expect(configModule.library.tags).to.be.an('array');
      expect(configModule.library.tags).to.have.length(9);
      
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
        'cosmiconfig': { cosmiconfigSync: () => mockCosmiconfig },
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
      process.exit = () => { exitCalled = true; };

      // Mock console.error to capture the error message
      const originalError = console.error;
      let errorMessage = '';
      console.error = (msg) => { errorMessage = msg; };

      try {
        proxyquire('../../../common/config/index.js', {
          'cosmiconfig': { cosmiconfigSync: () => mockCosmiconfig },
          './tags.json': [{ id: 'TPE1', name: 'artist', description: 'Artist' }],
          './validator': validatorModule,
          '../../package.json': { name: 'musicman', version: '1.0.0' }
        });

        expect(exitCalled).to.be.true;
        expect(errorMessage).to.include("Fatal error: Tag 'nonexistent_tag' defined in library.tags");
      } finally {
        process.exit = originalExit;
        console.error = originalError;
      }
    });
  });

  describe('Views Configuration', () => {
    it('should have default views configuration', () => {
      expect(configModule.views).to.be.an('object');
      expect(configModule.views.default).to.be.an('array');
      expect(configModule.views.edit).to.be.an('array');
      expect(configModule.views.playlist).to.be.an('array');
      expect(configModule.views.stats).to.be.an('array');
    });

    it('should merge user-specific view configurations', () => {
      // Check that user's edit view is used
      expect(configModule.views.edit).to.have.length(6);
      expect(configModule.views.edit.map(v => v.name)).to.include('context');
      expect(configModule.views.edit.map(v => v.name)).to.include('mood');
    });

    it('should fall back to default view when user view not specified', () => {
      // User config doesn't override playlist view, so it should use default
      expect(configModule.views.playlist).to.deep.equal(mockDefaultConfig.views.playlist);
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