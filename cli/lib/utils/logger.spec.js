const sinon = require('sinon');
const { expect } = require('chai');
const logger = require('./logger.js');

describe('Logger', () => {
  describe('availableWidth', () => {
    let originalColumns;

    beforeEach(() => {
      originalColumns = process.stdout.columns;
    });

    afterEach(() => {
      process.stdout.columns = originalColumns;
      logger.configure({ padding: 1 });
    });

    it('should subtract the configured left padding from terminal columns', () => {
      process.stdout.columns = 80;
      logger.configure({ padding: 3 });
      expect(logger.availableWidth()).to.equal(77);
    });

    it('should be unlimited when output is not a terminal', () => {
      process.stdout.columns = undefined;
      expect(logger.availableWidth()).to.equal(Infinity);
    });
  });

  describe('progress', () => {
    let originalIsTTY;
    let write;

    beforeEach(() => {
      originalIsTTY = process.stderr.isTTY;
      write = sinon.stub(process.stderr, 'write');
    });

    afterEach(() => {
      write.restore();
      process.stderr.isTTY = originalIsTTY;
    });

    it('should write a clearing status line to stderr when it is a terminal', () => {
      process.stderr.isTTY = true;
      logger.progress('Reading 1/2 files');
      logger.progressDone();
      expect(write.firstCall.args[0]).to.equal('\r\x1b[KReading 1/2 files');
      expect(write.secondCall.args[0]).to.equal('\r\x1b[K');
    });

    it('should not write anything when stderr is not a terminal', () => {
      process.stderr.isTTY = false;
      logger.progress('Reading 1/2 files');
      logger.progressDone();
      expect(write).to.not.have.been.called;
    });
  });
});
