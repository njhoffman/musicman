const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('Metadata Read', () => {
  let nodeId3Stub;
  let mp3DurationStub;
  let headerDurationStub;
  let fsStub;
  let readModule;

  beforeEach(() => {
    nodeId3Stub = { read: sinon.stub() };
    mp3DurationStub = sinon.stub();
    headerDurationStub = sinon.stub().resolves(null);
    fsStub = { stat: sinon.stub() };

    readModule = proxyquire('./read.js', {
      'node-id3': nodeId3Stub,
      'mp3-duration': mp3DurationStub,
      './duration.js': { readHeaderDuration: headerDurationStub },
      fs: fsStub
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getMetadata', () => {
    it('should read metadata for single file', async () => {
      const mockTags = { raw: { TPE1: 'Test Artist', TIT2: 'Test Title' } };
      nodeId3Stub.read.yields(null, mockTags);

      const result = await readModule.getMetadata(['test.mp3']);
      expect(result).to.have.length(1);
      expect(result[0]).to.deep.equal(['test.mp3', mockTags.raw]);
    });

    it('should replace cover art with a presence marker', async () => {
      const mockTags = {
        raw: { TPE1: 'Test Artist', APIC: { imageBuffer: Buffer.from('image') } }
      };
      nodeId3Stub.read.yields(null, mockTags);

      const [[, rawTags]] = await readModule.getMetadata(['test.mp3']);
      expect(rawTags).to.deep.equal({ TPE1: 'Test Artist', APIC: true });
    });

    it('should not add a cover art marker when there is no cover art', async () => {
      nodeId3Stub.read.yields(null, { raw: { TPE1: 'Test Artist' } });

      const [[, rawTags]] = await readModule.getMetadata(['test.mp3']);
      expect(rawTags).to.not.have.property('APIC');
    });

    it('should read metadata for multiple files', async () => {
      const mockTags = { raw: { TPE1: 'Test Artist' } };
      nodeId3Stub.read.yields(null, mockTags);

      const result = await readModule.getMetadata(['file1.mp3', 'file2.mp3']);
      expect(result).to.have.length(2);
      expect(nodeId3Stub.read.callCount).to.equal(2);
    });

    it('should handle read errors', async () => {
      nodeId3Stub.read.yields(new Error('Read error'));

      try {
        await readModule.getMetadata(['test.mp3']);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Read error');
      }
    });
  });

  describe('getMetadataFull', () => {
    it('should read duration from frame headers without decoding', async () => {
      nodeId3Stub.read.yields(null, { raw: { TPE1: 'Test Artist' } });
      headerDurationStub.resolves(200.25);
      fsStub.stat.yields(null, { size: 5000000 });

      const [[, rawTags]] = await readModule.getMetadataFull(['test.mp3']);
      expect(rawTags.duration).to.equal(200.25);
      expect(mp3DurationStub).to.not.have.been.called;
    });

    it('should reject when reading the file size fails', async () => {
      nodeId3Stub.read.yields(null, { raw: { TPE1: 'Test Artist' } });
      headerDurationStub.resolves(200);
      fsStub.stat.yields(new Error('EACCES'));

      try {
        await readModule.getMetadataFull(['test.mp3']);
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.equal('EACCES');
      }
    });

    it('should reject when reading the duration fails', async () => {
      nodeId3Stub.read.yields(null, { raw: { TPE1: 'Test Artist' } });
      headerDurationStub.rejects(new Error('ENOENT'));
      fsStub.stat.yields(null, { size: 1 });

      try {
        await readModule.getMetadataFull(['test.mp3']);
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.equal('ENOENT');
      }
    });

    it('should decode duration when no frame header is found', async () => {
      const mockTags = { raw: { TPE1: 'Test Artist' } };
      nodeId3Stub.read.yields(null, mockTags);
      mp3DurationStub.yields(null, 180.5);
      fsStub.stat.yields(null, { size: 5000000 });

      const result = await readModule.getMetadataFull(['test.mp3']);
      expect(result).to.have.length(1);
      expect(result[0][1]).to.include({ duration: 180.5, size: 5000000 });
    });
  });

  describe('parseMetadata', () => {
    const config = {
      library: {
        tags: [
          { name: 'artist', id: 'TPE1' },
          { name: 'title', id: 'TIT2' },
          { name: 'custom', id: 'TXXX.Custom' }
        ]
      },
      rating: { tag: 'POPM', max: 5 }
    };

    it('should transform id3 tags to config names', () => {
      const rawTags = { TPE1: 'Test Artist', TIT2: 'Test Title' };
      const result = readModule.parseMetadata(rawTags, config);
      expect(result).to.deep.equal({ artist: 'Test Artist', title: 'Test Title' });
    });

    it('should handle TXXX custom tags', () => {
      const rawTags = {
        TPE1: 'Test Artist',
        TXXX: [{ description: 'Custom', value: 'Custom Value' }]
      };
      const result = readModule.parseMetadata(rawTags, config);
      expect(result).to.include({ custom: 'Custom Value' });
    });

    it('should convert rating values', () => {
      const rawTags = { POPM: { rating: 128 } };
      const result = readModule.parseMetadata(rawTags, config);
      expect(result.rating).to.equal('2.5');
    });

    it('should include duration and size if present', () => {
      const rawTags = { duration: 180.5, size: 5000000 };
      const result = readModule.parseMetadata(rawTags, config);
      expect(result).to.include({ duration: 180.5, size: 5000000 });
    });

    it('should only read frames defined in library.tags', () => {
      const rawTags = {
        TPE1: 'Test Artist',
        TPE2: 'Test Album Artist',
        TXXX: [{ description: 'Other', value: 'Other Value' }]
      };
      const result = readModule.parseMetadata(rawTags, {
        ...config,
        tags: [{ name: 'album_artist', id: 'TPE2' }]
      });
      expect(result).to.deep.equal({ artist: 'Test Artist' });
    });

    it('should read tags resolved from tags.json once in library.tags', () => {
      const libraryConfig = {
        ...config,
        library: { tags: [...config.library.tags, { name: 'album_artist', id: 'TPE2' }] }
      };
      const rawTags = { TPE1: 'Test Artist', TPE2: 'Test Album Artist' };
      const result = readModule.parseMetadata(rawTags, libraryConfig);
      expect(result).to.deep.equal({ artist: 'Test Artist', album_artist: 'Test Album Artist' });
    });
  });
});
