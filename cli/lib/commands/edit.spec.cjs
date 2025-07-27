const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('Edit Command', () => {
  let getFilteredFilesStub;
  let saveMetadataStub;
  let checkExistsStub;
  let confirmStub;
  let outputStub;
  let editCommand;

  beforeEach(() => {
    getFilteredFilesStub = sinon.stub();
    saveMetadataStub = sinon.stub();
    checkExistsStub = sinon.stub();
    confirmStub = sinon.stub();
    outputStub = sinon.stub();

    editCommand = proxyquire('./edit.cjs', {
      './common.cjs': {
        getFilteredFiles: getFilteredFilesStub,
        saveMetadata: saveMetadataStub
      },
      '../utils/files.cjs': {
        checkExists: checkExistsStub
      },
      '../output/index.cjs': {
        outputDifferences: outputStub
      },
      'prompt-confirm': function() {
        return { run: confirmStub };
      }
    });

    // Suppress console output during tests
    sinon.stub(process.stdout, 'write');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('editCommand', () => {
    const mockConfig = { tags: [] };
    const mockOptions = { assignments: { artist: 'New Artist' } };

    it('should throw error when target does not exist', async () => {
      checkExistsStub.returns(false);

      try {
        await editCommand.func({
          target: '/nonexistent',
          options: mockOptions,
          config: mockConfig
        });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Target does not exist');
      }
    });

    it('should process single file without confirmation', async () => {
      checkExistsStub.returns(true);
      const mockFiles = [['file1.mp3', { artist: 'Old Artist' }]];
      getFilteredFilesStub.resolves(mockFiles);
      saveMetadataStub.returns(true);

      const result = await editCommand.func({
        target: '/path/file.mp3',
        options: mockOptions,
        config: mockConfig
      });

      expect(result.oldFiles).to.deep.equal(mockFiles);
      expect(saveMetadataStub.calledOnce).to.be.true;
      expect(confirmStub.called).to.be.false;
    });

    it('should request confirmation for multiple files', async () => {
      checkExistsStub.returns(true);
      const mockFiles = [
        ['file1.mp3', { artist: 'Old Artist 1' }],
        ['file2.mp3', { artist: 'Old Artist 2' }]
      ];
      getFilteredFilesStub.resolves(mockFiles);
      confirmStub.resolves(true);
      saveMetadataStub.returns(true);

      const result = await editCommand.func({
        target: '/path/dir',
        options: mockOptions,
        config: mockConfig
      });

      expect(confirmStub.calledOnce).to.be.true;
      expect(result.oldFiles).to.deep.equal(mockFiles);
    });

    it('should abort when user declines confirmation', async () => {
      checkExistsStub.returns(true);
      const mockFiles = [
        ['file1.mp3', { artist: 'Old Artist 1' }],
        ['file2.mp3', { artist: 'Old Artist 2' }]
      ];
      getFilteredFilesStub.resolves(mockFiles);
      confirmStub.resolves(false);

      const result = await editCommand.func({
        target: '/path/dir',
        options: mockOptions,
        config: mockConfig
      });

      expect(result).to.be.false;
      expect(saveMetadataStub.called).to.be.false;
    });

    it('should return false when no files match filter', async () => {
      checkExistsStub.returns(true);
      getFilteredFilesStub.resolves([]);

      const result = await editCommand.func({
        target: '/path/dir',
        options: mockOptions,
        config: mockConfig
      });

      expect(result).to.be.false;
      expect(saveMetadataStub.called).to.be.false;
    });

    it('should display differences after successful edit', async () => {
      checkExistsStub.returns(true);
      const mockFiles = [['file1.mp3', { artist: 'Old Artist' }]];
      const savedFiles = [['file1.mp3', { artist: 'New Artist' }]];

      getFilteredFilesStub.onFirstCall().resolves(mockFiles);
      getFilteredFilesStub.onSecondCall().resolves(savedFiles);
      saveMetadataStub.returns(true);

      await editCommand.func({
        target: '/path/file.mp3',
        options: mockOptions,
        config: mockConfig
      });

      expect(outputStub.calledOnce).to.be.true;
    });
  });
});
