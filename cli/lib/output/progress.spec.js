const { expect } = require('chai');
const { formatClock, progressBar } = require('./progress.js');

describe('Progress bar', () => {
  it('should show the bar, percent, and counts', () => {
    expect(progressBar({ done: 3, total: 10, width: 10 })).to.equal('[###-------] 30% 3/10');
  });

  it('should add the rate, ETA, and detail once something is done', () => {
    const startedAt = new Date('2026-10-20T10:00:00Z');
    const now = new Date('2026-10-20T10:00:05Z');
    expect(
      progressBar({ done: 10, total: 30, width: 10, startedAt, now, detail: '8 matched' })
    ).to.equal('[###-------] 33% 10/30 2.0/s ETA 0:10 8 matched');
  });

  it('should be full when there is nothing to do', () => {
    expect(progressBar({ done: 0, total: 0, width: 4 })).to.equal('[####] 100% 0/0');
  });

  it('should format seconds as minutes and seconds', () => {
    expect(formatClock(0)).to.equal('0:00');
    expect(formatClock(125.4)).to.equal('2:05');
  });
});
