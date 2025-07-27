const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('Metadata Read', () => {
  let nodeId3Stub;
  let mp3DurationStub;
  let fsStub;
  let readModule;

  beforeEach(() => {
    nodeId3Stub = { read: sinon.stub() };
    mp3DurationStub = sinon.stub();
    fsStub = { stat: sinon.stub() };

    readModule = proxyquire('./read.cjs', {
      'node-id3': nodeId3Stub,
      'mp3-duration': mp3DurationStub,
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
    it('should read metadata with duration and size', async () => {
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
      tags: [
        { name: 'artist', id: 'TPE1' },
        { name: 'title', id: 'TIT2' },
        { name: 'custom', id: 'TXXX.Custom' }
      ],
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
  });
});
