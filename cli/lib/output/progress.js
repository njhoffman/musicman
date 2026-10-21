const formatClock = seconds => {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${`${total % 60}`.padStart(2, '0')}`;
};

/**
 * Progress bar for the footer status line, e.g. "[######----] 60% 6/10 2.0/s ETA 0:02 <detail>".
 * Rate and ETA are left out until something is done and startedAt (a Date) is given.
 */
const progressBar = ({ done, total, detail = '', startedAt, now = new Date(), width = 30 }) => {
  const ratio = total > 0 ? Math.min(done / total, 1) : 1;
  const filled = Math.round(ratio * width);
  const parts = [
    `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`,
    `${Math.floor(ratio * 100)}%`,
    `${done}/${total}`
  ];
  const seconds = startedAt ? (now - startedAt) / 1000 : 0;
  if (done > 0 && seconds > 0) {
    const rate = done / seconds;
    parts.push(`${rate.toFixed(1)}/s`, `ETA ${formatClock((total - done) / rate)}`);
  }
  return [...parts, detail].filter(Boolean).join(' ');
};

module.exports = { formatClock, progressBar };
