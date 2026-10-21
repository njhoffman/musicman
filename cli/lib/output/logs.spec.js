const { expect } = require('chai');
const { outputRunList, runOneline, runRecords, runSummary } = require('./logs.js');
const { stripAnsi } = require('../utils/logger.js');

describe('Logs Output', () => {
  it('should summarize what each kind of run did', () => {
    expect(
      runSummary({ result: { summary: { match: 3, review: 1, missing: 0, refresh: 2 } } })
    ).to.equal('3 match, 2 refresh, 1 review');
    expect(runSummary({ result: { summary: { scanned: 5, added: 1, removed: 2 } } })).to.equal(
      '1 added, 2 removed'
    );
    expect(runSummary({ result: { summary: { scanned: 5 } } })).to.equal('unchanged');
    expect(
      runSummary({ result: { sorted: 4, failed: 1, summary: { scanned: 9, moved: 4 } } })
    ).to.equal('4 sorted, 1 failed');
    expect(runSummary({ result: { newFiles: [1, 2] } })).to.equal('2 files edited');
    expect(
      runSummary({ result: { plan: [{ add: [1], prune: [], pull: [1, 2] }, { add: [1] }] } })
    ).to.equal('plan: 2 to add, 0 to prune, 2 to pull');
    expect(runSummary({ error: 'boom', result: null })).to.equal('boom');
    expect(runSummary({ result: null })).to.equal('');
  });

  it('should key run onelines by id', () => {
    const [record] = runRecords([
      {
        id: '20261020-120000-sync',
        command: 'sync',
        args: ['sync', '--push'],
        status: 'ok',
        startedAt: '2026-10-20T12:00:00Z'
      }
    ]);
    expect(stripAnsi(runOneline(record))).to.match(
      /^20261020-120000-sync\tok\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2} sync --push $/
    );
  });

  it('should say when there are no runs', () => {
    expect(outputRunList([])).to.equal('No archived runs');
  });
});
