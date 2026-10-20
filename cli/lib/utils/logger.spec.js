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

  describe('log file', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let directory;
    let logFile;
    const lines = () => fs.readFileSync(logFile, 'utf8').trim().split('\n');

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-log-'));
      logFile = path.join(directory, 'logs', 'musicman.log');
    });

    afterEach(() => {
      logger.configureLogFile();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    it('should write messages up to the configured level with timestamp and level', () => {
      logger.configureLogFile({ name: logFile, level: 'info' });
      logger.info('info message');
      logger.debug('debug message');
      logger.warn('warn message');
      expect(lines()).to.have.length(2);
      expect(lines()[0]).to.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO {2}info message$/);
      expect(lines()[1]).to.match(/ WARN {2}warn message$/);
    });

    it('should strip colors and append to an existing log', () => {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, 'existing\n');
      logger.configureLogFile({ name: logFile, level: 'debug' });
      logger.debug('\u001b[31mred\u001b[39m text');
      expect(lines()).to.have.length(2);
      expect(lines()[1]).to.match(/ DEBUG red text$/);
    });

    it('should write file only messages without logging to the console', () => {
      logger.configureLogFile({ name: logFile, level: 'debug' });
      expect(logger.logToFile('debug', 'added song.mp3')).to.be.undefined;
      expect(lines()[0]).to.match(/ DEBUG added song.mp3$/);
    });

    it('should not write anything without a log file', () => {
      logger.configureLogFile();
      logger.error('not written');
      expect(fs.existsSync(logFile)).to.be.false;
    });
  });

  describe('verbosity', () => {
    afterEach(() => {
      logger.configure({ verbosity: 'info' });
    });

    it('should show messages up to the configured level name', () => {
      // shown messages come back padded by consoleLog, hidden ones come back unchanged
      logger.configure({ verbosity: 'info' });
      expect(logger.info('shown')).to.equal(' shown');
      expect(logger.debug('hidden')).to.equal('hidden');
      logger.configure({ verbosity: 'trace' });
      expect(logger.trace('shown')).to.equal(' shown');
    });
  });
});
