const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');
const { escape } = require('glob');

describe('Files Utilities', () => {
  let statSyncStub;
  let globStub;
  let filesModule;

  beforeEach(() => {
    statSyncStub = sinon.stub();
    globStub = { globSync: sinon.stub(), escape };

    filesModule = proxyquire('./files.cjs', {
      fs: { statSync: statSyncStub },
      glob: globStub
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('checkExists', () => {
    it('should return stat object when file exists', () => {
      const mockStat = { isFile: () => true, isDirectory: () => false };
      statSyncStub.returns(mockStat);

      const result = filesModule.checkExists('/path/to/file.mp3');
      expect(result).to.equal(mockStat);
      expect(statSyncStub.calledWith('/path/to/file.mp3')).to.be.true;
    });

    it('should return false when file does not exist', () => {
      statSyncStub.throws(new Error('ENOENT'));

      const result = filesModule.checkExists('/nonexistent/file.mp3');
      expect(result).to.be.false;
    });
  });

  describe('getFiles', () => {
    it('should return single file when target is a file', () => {
      const mockStat = { isFile: () => true, isDirectory: () => false };
      statSyncStub.returns(mockStat);

      const result = filesModule.getFiles('/path/to/file.mp3');
      expect(result).to.deep.equal(['/path/to/file.mp3']);
    });

    it('should return files from directory non-recursively', () => {
      const mockStat = { isFile: () => false, isDirectory: () => true };
      statSyncStub.returns(mockStat);
      globStub.globSync.returns(['file1.mp3', 'file2.mp3']);

      const result = filesModule.getFiles('/path/to/dir', { ext: 'mp3', recursive: false });
      expect(result).to.deep.equal(['file1.mp3', 'file2.mp3']);
      expect(globStub.globSync.calledWith('/path/to/dir/*.mp3')).to.be.true;
    });

    it('should return files from directory recursively', () => {
      const mockStat = { isFile: () => false, isDirectory: () => true };
      statSyncStub.returns(mockStat);
      globStub.globSync.returns(['sub/file1.mp3', 'sub/file2.mp3']);

      const result = filesModule.getFiles('/path/to/dir', { ext: 'mp3', recursive: true });
      expect(result).to.deep.equal(['sub/file1.mp3', 'sub/file2.mp3']);
      expect(globStub.globSync.calledWith('/path/to/dir/**/*.mp3')).to.be.true;
    });

    it('should escape square brackets in directory names', () => {
      const mockStat = { isFile: () => false, isDirectory: () => true };
      statSyncStub.returns(mockStat);
      globStub.globSync.returns([]);

      filesModule.getFiles('/path/[bracket]/dir', { ext: 'mp3', recursive: false });
      expect(globStub.globSync.calledWith('/path/\\[bracket\\]/dir/*.mp3')).to.be.true;
    });

    it('should escape every glob character in directory names', () => {
      const mockStat = { isFile: () => false, isDirectory: () => true };
      statSyncStub.returns(mockStat);
      globStub.globSync.returns([]);

      filesModule.getFiles('/path/[a] [b]/(c)*', { ext: 'mp3', recursive: false });
      expect(globStub.globSync.calledWith('/path/\\[a\\] \\[b\\]/\\(c\\)\\*/*.mp3')).to.be.true;
    });

    it('should return files sorted by path', () => {
      const mockStat = { isFile: () => false, isDirectory: () => true };
      statSyncStub.returns(mockStat);
      globStub.globSync.returns(['/dir/b.mp3', '/dir/a/c.mp3', '/dir/a.mp3']);

      const result = filesModule.getFiles('/dir', { ext: 'mp3', recursive: true });
      expect(result).to.deep.equal(['/dir/a.mp3', '/dir/a/c.mp3', '/dir/b.mp3']);
    });

    it('should return null when target does not exist', () => {
      statSyncStub.throws(new Error('ENOENT'));

      const result = filesModule.getFiles('/nonexistent/path');
      expect(result).to.be.null;
    });

    it('should use default options when none provided', () => {
      const mockStat = { isFile: () => false, isDirectory: () => true };
      statSyncStub.returns(mockStat);
      globStub.globSync.returns(['file1.mp3']);

      const result = filesModule.getFiles('/path/to/dir');
      expect(result).to.deep.equal(['file1.mp3']);
      expect(globStub.globSync.calledWith('/path/to/dir/*.mp3')).to.be.true;
    });
  });
});
