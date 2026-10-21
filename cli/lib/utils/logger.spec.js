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

    it('should keep the status line below messages logged while it is shown', () => {
      process.stderr.isTTY = true;
      const { NODE_ENV } = process.env;
      const consoleLog = sinon.stub(console, 'log');
      try {
        process.env.NODE_ENV = 'development';
        logger.progress('Matching 1/2 songs');
        logger.consoleLog('matched song.mp3');
        logger.progressDone();
        logger.consoleLog('after');
      } finally {
        process.env.NODE_ENV = NODE_ENV;
        consoleLog.restore();
      }
      expect(write.args.map(([text]) => text)).to.deep.equal([
        '\r\x1b[KMatching 1/2 songs',
        '\r\x1b[K',
        '\r\x1b[KMatching 1/2 songs',
        '\r\x1b[K'
      ]);
      expect(consoleLog.args.map(([text]) => text)).to.deep.equal([' matched song.mp3', ' after']);
    });

    it('should cut the status line to the terminal width without colors', () => {
      process.stderr.isTTY = true;
      const originalColumns = process.stderr.columns;
      process.stderr.columns = 10;
      try {
        logger.progress('\u001b[31m0123456789abc\u001b[39m');
        logger.progressDone();
      } finally {
        process.stderr.columns = originalColumns;
      }
      expect(write.firstCall.args[0]).to.equal('\r\x1b[K012345678');
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

    it('should also write messages to the run log at its own level', () => {
      const runLog = path.join(directory, 'runs', 'run.log');
      logger.configureLogFile({ name: logFile, level: 'info' });
      logger.configureRunLog({ name: runLog, level: 'debug' });
      logger.info('both');
      logger.debug('run only');
      logger.configureRunLog();
      logger.info('main only');
      expect(lines()).to.have.length(2);
      expect(lines()[1]).to.match(/ INFO {2}main only$/);
      const runLines = fs.readFileSync(runLog, 'utf8').trim().split('\n');
      expect(runLines).to.have.length(2);
      expect(runLines[1]).to.match(/ DEBUG run only$/);
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
      logger.configureColors({});
      logger.configure({ verbosity: 'info' });
      expect(logger.info('shown')).to.equal('  INFO   shown');
      expect(logger.debug('hidden')).to.equal('hidden');
      logger.configure({ verbosity: 'trace' });
      expect(logger.trace('shown')).to.equal('  TRACE  shown');
      logger.configureColors(require('musicman-common/config').defaultConfig.logger.colors);
    });
  });

  describe('level badges', () => {
    let originalLevel;
    const chalk = require('chalk').default;

    beforeEach(() => {
      originalLevel = chalk.level;
      chalk.level = 3;
    });

    afterEach(() => {
      chalk.level = originalLevel;
      logger.configureColors(require('musicman-common/config').defaultConfig.logger.colors);
    });

    it('should color the level badge with the configured fg, bg, and gui', () => {
      logger.configureColors({ warn: { fg: '#FFFFFF', bg: '#B43C14', gui: 'bold' } });
      const output = logger.warn('careful');
      expect(output).to.equal(` ${chalk.hex('#FFFFFF').bgHex('#B43C14').bold(' WARN ')}  careful`);
    });

    it('should leave the badge uncolored for a level without colors', () => {
      logger.configureColors({});
      expect(logger.info('plain')).to.equal('  INFO   plain');
      expect(logger.error('aligned')).to.equal('  ERROR  aligned');
    });

    it('should put the badge after leading blank lines', () => {
      logger.configureColors({});
      expect(logger.info('\nSummary')).to.equal(' \n  INFO   Summary');
    });

    it('should not add badges to the log file', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-badge-'));
      const file = path.join(directory, 'musicman.log');
      logger.configureLogFile({ name: file, level: 'info' });
      logger.info('message');
      logger.configureLogFile();
      expect(fs.readFileSync(file, 'utf8')).to.match(/Z INFO {2}message\n$/);
      fs.rmSync(directory, { recursive: true, force: true });
    });
  });
});
