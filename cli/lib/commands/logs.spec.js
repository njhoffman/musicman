const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const logsCommand = require('./logs.js');
const { stripAnsi } = require('../utils/logger.js');

describe('Logs Command', () => {
  let directory;
  let config;
  const write = (id, report, log) => {
    fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify({ id, ...report }));
    if (log !== undefined) {
      fs.writeFileSync(path.join(directory, `${id}.log`), log);
    }
  };
  const run = (terms, switches = {}) => {
    const paged = [];
    return logsCommand
      .func({ options: { terms, switches }, config, pager: text => paged.push(stripAnsi(text)) })
      .then(result => ({ ...result, paged }));
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-logs-'));
    config = { logger: { archive: { directory } } };
    write(
      '20261019-100000-db',
      {
        command: 'db',
        args: ['db', '--update'],
        status: 'ok',
        result: { summary: { scanned: 9, added: 2 } }
      },
      '2026-10-19T10:00:00.000Z INFO  Updating database\n'
    );
    write(
      '20261020-120000-sync',
      {
        command: 'sync',
        args: ['sync', '--match'],
        status: 'interrupted',
        exitCode: 130,
        seconds: 75
      },
      '2026-10-20T12:00:01.000Z INFO  MATCH   beets  A - B\n2026-10-20T12:01:15.000Z WARN  Interrupted by SIGINT\n'
    );
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('should list runs newest first, or only the runs of a command', async () => {
    expect((await run([])).runs.map(({ id }) => id)).to.deep.equal([
      '20261020-120000-sync',
      '20261019-100000-db'
    ]);
    expect((await run(['db'])).runs.map(({ id }) => id)).to.deep.equal(['20261019-100000-db']);
  });

  it('should show a run by id, id prefix, or latest with its report and log', async () => {
    const { report, paged } = await run(['latest']);
    expect(report.id).to.equal('20261020-120000-sync');
    expect(paged[0].split('\n')).to.deep.equal([
      '20261020-120000-sync  interrupted (exit 130)',
      'command  musicman sync --match',
      'started  ?  took 1:15',
      '',
      '2026-10-20T12:00:01.000Z INFO  MATCH   beets  A - B',
      '2026-10-20T12:01:15.000Z WARN  Interrupted by SIGINT'
    ]);
    expect((await run(['20261019'])).report.id).to.equal('20261019-100000-db');
    expect((await run(['20261019-100000-db'])).paged[0]).to.include('summary  2 added');
  });

  it('should fail for a run that does not exist', async () => {
    expect((await run(['2025'])).report).to.be.null;
    expect(process.exitCode).to.equal(1);
  });

  it('should write the run list in another format', async () => {
    const written = [];
    const original = process.stdout.write;
    process.stdout.write = text => written.push(text);
    try {
      await run([], { format: 'json' });
    } finally {
      process.stdout.write = original;
    }
    const [sync, db] = JSON.parse(written.join(''));
    expect(sync).to.include({
      id: '20261020-120000-sync',
      args: 'sync --match',
      status: 'interrupted'
    });
    expect(db.summary).to.equal('2 added');
  });
  describe('page', () => {
    let written;
    let original;

    beforeEach(() => {
      written = [];
      original = process.stdout.write;
      process.stdout.write = text => written.push(text);
    });

    afterEach(() => {
      process.stdout.write = original;
    });

    it('should write straight to stdout when it is not a terminal', () => {
      logsCommand.page('text', { isTTY: false });
      expect(written).to.deep.equal(['text\n']);
    });

    it('should use $PAGER on a terminal and not repeat the text when the pager quits early', () => {
      const spawned = [];
      const spawn = result => (command, options) => {
        spawned.push([command, options.input]);
        return result;
      };
      const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      logsCommand.page('text', {
        isTTY: true,
        env: { PAGER: 'more' },
        spawn: spawn({ status: 0, error: epipe })
      });
      expect(spawned).to.deep.equal([['more', 'text\n']]);
      expect(written).to.be.empty;
    });

    it('should fall back to stdout when the pager cannot be found', () => {
      logsCommand.page('text', { isTTY: true, env: {}, spawn: () => ({ status: 127 }) });
      expect(written).to.deep.equal(['text\n']);
    });
  });
});
