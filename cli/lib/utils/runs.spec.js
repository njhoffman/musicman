const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const logger = require('./logger.js');
const { archives, finishRun, listRuns, pruneRuns, runsDirectory, startRun } = require('./runs.js');

describe('Run archive', () => {
  let directory;
  let config;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-runs-'));
    config = { logger: { archive: { directory, level: 'debug', keep: 2 } } };
  });

  afterEach(() => {
    logger.configureRunLog();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('runsDirectory', () => {
    it('should default to the musicman logs directory in XDG_STATE_HOME', () => {
      expect(runsDirectory({}, { XDG_STATE_HOME: '/state' })).to.equal('/state/musicman/logs');
    });

    it('should use logger.archive.directory when set', () => {
      expect(runsDirectory(config, { XDG_STATE_HOME: '/state' })).to.equal(directory);
    });
  });

  describe('archives', () => {
    it('should follow a boolean or a function of the switches', () => {
      expect(archives({ archive: true })).to.be.true;
      expect(archives({})).to.be.false;
      const db = { archive: ({ update }) => update };
      expect(archives(db, { update: true })).to.be.true;
      expect(archives(db, {})).to.be.false;
    });
  });

  describe('startRun and finishRun', () => {
    const startedAt = new Date(2026, 9, 20, 19, 35, 12);

    it('should write the run log and a report with the result', () => {
      const run = startRun({ command: 'sync', args: ['sync', '--match'], config, now: startedAt });
      expect(run.id).to.equal('20261020-193512-sync');
      logger.debug('matched song.mp3');
      const report = finishRun(run, {
        config,
        result: { summary: { match: 1 } },
        now: new Date(startedAt.getTime() + 2500)
      });
      expect(report).to.include({ status: 'ok', exitCode: 0, seconds: 2.5 });
      expect(JSON.parse(fs.readFileSync(run.reportFile, 'utf8')).result).to.deep.equal({
        summary: { match: 1 }
      });
      expect(fs.readFileSync(run.logFile, 'utf8')).to.match(/ DEBUG matched song.mp3\n$/);
      logger.debug('not archived');
      expect(fs.readFileSync(run.logFile, 'utf8')).to.not.include('not archived');
    });

    it('should list a run that has not finished as running', () => {
      startRun({ command: 'sync', args: [], config, now: startedAt });
      expect(listRuns(directory)[0]).to.include({ id: '20261020-193512-sync', status: 'running' });
    });

    it('should give runs started in the same second their own id', () => {
      const first = startRun({ command: 'edit', args: [], config, now: startedAt });
      const second = startRun({ command: 'edit', args: [], config, now: startedAt });
      expect(first.id).to.equal('20261020-193512-edit');
      expect(second.id).to.equal('20261020-193512-edit-2');
    });

    it('should mark a run failed by an error or an exit code', () => {
      const run = startRun({ command: 'db', args: [], config, now: startedAt });
      expect(finishRun(run, { config, error: new Error('boom') })).to.include({
        status: 'failed',
        exitCode: 1,
        error: 'boom'
      });
      const exited = startRun({ command: 'db', args: [], config });
      expect(finishRun(exited, { config, exitCode: 2 })).to.include({
        status: 'failed',
        exitCode: 2
      });
    });

    it('should mark a run stopped by a signal as interrupted', () => {
      const run = startRun({ command: 'sync', args: [], config, now: startedAt });
      expect(finishRun(run, { config, interrupted: true, exitCode: 130 })).to.include({
        status: 'interrupted',
        exitCode: 130
      });
    });

    it('should keep a report when the result cannot be serialized', () => {
      const run = startRun({ command: 'db', args: [], config, now: startedAt });
      const result = {};
      result.self = result;
      expect(finishRun(run, { config, result }).result).to.have.property('unserializable');
    });
  });

  describe('pruneRuns', () => {
    const touch = id =>
      ['json', 'log'].forEach(ext => fs.writeFileSync(path.join(directory, `${id}.${ext}`), '{}'));

    it('should remove the oldest runs of the command beyond keep', () => {
      touch('20261018-100000-sync');
      touch('20261019-100000-sync');
      touch('20261019-100000-sync-2');
      touch('20261017-100000-edit');
      expect(pruneRuns(directory, 'sync', 2)).to.deep.equal(['20261018-100000-sync']);
      expect(fs.readdirSync(directory).sort()).to.deep.equal([
        '20261017-100000-edit.json',
        '20261017-100000-edit.log',
        '20261019-100000-sync-2.json',
        '20261019-100000-sync-2.log',
        '20261019-100000-sync.json',
        '20261019-100000-sync.log'
      ]);
    });
  });

  describe('listRuns', () => {
    it('should list reports newest first and skip unreadable ones', () => {
      fs.writeFileSync(path.join(directory, '20261019-100000-sync.json'), '{"id":"b"}');
      fs.writeFileSync(path.join(directory, '20261018-100000-sync.json'), '{"id":"a"}');
      fs.writeFileSync(path.join(directory, '20261020-100000-sync.json'), 'not json');
      expect(listRuns(directory)).to.deep.equal([{ id: 'b' }, { id: 'a' }]);
    });

    it('should be empty without a runs directory', () => {
      expect(listRuns(path.join(directory, 'missing'))).to.deep.equal([]);
    });
  });
});
