const chalk = require('chalk').default;

const colors = { label: '#8888FF', filled: '#33CCAA', empty: '#3A3A48', muted: '#888899' };

const muted = text => chalk.hex(colors.muted)(text);

const formatClock = seconds => {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${`${total % 60}`.padStart(2, '0')}`;
};

// a long wait like 4h 33m, or 12m, or 40s
const formatWait = seconds => {
  const total = Math.ceil(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return minutes > 0 ? `${minutes}m` : `${total}s`;
};

/**
 * Colored progress bar for the footer status line, e.g.
 * "Matching ━━━━━━──── 60% 6/10 songs  2.0/s  ETA 0:02  <detail>". Rate and ETA are left out until
 * something is done and startedAt (a Date) is given.
 */
const progressBar = ({
  done,
  total,
  label = '',
  unit = '',
  detail = '',
  startedAt,
  now = new Date(),
  width = 24
}) => {
  const ratio = total > 0 ? Math.min(done / total, 1) : 1;
  const filled = Math.round(ratio * width);
  const bar =
    chalk.hex(colors.filled)('━'.repeat(filled)) +
    chalk.hex(colors.empty)('━'.repeat(width - filled));
  const count = `${done}/${total}${unit ? ` ${unit}` : ''}`;
  const head = [
    label && chalk.hex(colors.label).bold(label),
    bar,
    chalk.bold(`${Math.floor(ratio * 100)}%`.padStart(4)),
    count
  ]
    .filter(Boolean)
    .join(' ');
  const parts = [head];
  const seconds = startedAt ? (now - startedAt) / 1000 : 0;
  if (done > 0 && seconds > 0) {
    const rate = done / seconds;
    parts.push(muted(`${rate.toFixed(1)}/s`), muted(`ETA ${formatClock((total - done) / rate)}`));
  }
  return [...parts, detail].filter(Boolean).join('  ');
};

/**
 * Counts as colored "● 12 matched" items, e.g. for the progress detail; zero counts are left out so
 * the status line fits. items are [count, word, color] triples.
 */
const coloredCounts = items =>
  items
    .filter(([count]) => count > 0)
    .map(([count, word, color]) => `${chalk.hex(color)('●')} ${count} ${word}`)
    .join('  ');

module.exports = { coloredCounts, formatClock, formatWait, progressBar };
