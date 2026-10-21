const { expect } = require('chai');
const chalk = require('chalk').default;
const { coloredCounts, formatClock, progressBar } = require('./progress.js');
const { stripAnsi } = require('../utils/logger.js');

describe('Progress bar', () => {
  let originalLevel;

  beforeEach(() => {
    originalLevel = chalk.level;
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = originalLevel;
  });

  it('should show the label, bar, percent, and counts', () => {
    expect(
      stripAnsi(progressBar({ done: 3, total: 10, width: 10, label: 'Matching', unit: 'songs' }))
    ).to.equal('Matching ━━━━━━━━━━  30% 3/10 songs');
  });

  it('should color the done and remaining parts of the bar differently', () => {
    const bar = progressBar({ done: 5, total: 10, width: 4 });
    expect(bar).to.include(chalk.hex('#33CCAA')('━━'));
    expect(bar).to.include(chalk.hex('#3A3A48')('━━'));
  });

  it('should add the rate, ETA, and detail once something is done', () => {
    const startedAt = new Date('2026-10-20T10:00:00Z');
    const now = new Date('2026-10-20T10:00:05Z');
    expect(
      stripAnsi(
        progressBar({ done: 10, total: 30, width: 10, startedAt, now, detail: '8 matched' })
      )
    ).to.equal('━━━━━━━━━━  33% 10/30  2.0/s  ETA 0:10  8 matched');
  });

  it('should be full when there is nothing to do', () => {
    expect(stripAnsi(progressBar({ done: 0, total: 0, width: 4 }))).to.equal('━━━━ 100% 0/0');
  });

  it('should color counts and leave out the zero ones', () => {
    const counts = coloredCounts([
      [3, 'matched', '#55CC55'],
      [0, 'failed', '#DD4444'],
      [1, 'review', '#DDCC44']
    ]);
    expect(stripAnsi(counts)).to.equal('● 3 matched  ● 1 review');
    expect(counts).to.include(chalk.hex('#55CC55')('●'));
  });

  it('should format seconds as minutes and seconds', () => {
    expect(formatClock(0)).to.equal('0:00');
    expect(formatClock(125.4)).to.equal('2:05');
  });
});
