const chalk = require('chalk').default;

const logger = require('../utils/logger.js');

const { availableWidth, consoleLog } = logger;
const { progressBar } = require('./progress.js');
const { renderKeyValues } = require('./render.js');

const title = text => chalk.hex('#8888FF')(text);
const key = text => chalk.hex('#33CCAA')(text);

const section = (heading, pairs) =>
  `\n${title(heading)}\n${renderKeyValues(pairs, availableWidth() - 2, { formatKey: key })
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')}\n`;

const formatBytes = bytes => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.ceil(bytes / 1024)} KB`;
};

const formatUpdateCounts = ({ target, added, updated, moved, removed }) =>
  `${target}: ${added} added, ${updated} updated, ${moved} moved, ${removed} removed`;

const formatDuration = seconds => `${Math.round(seconds / 60)} min`;

// progress bar line for db --update
const formatProgress = ({ done, total, added, updated, moved }, startedAt) =>
  progressBar({
    done,
    total,
    startedAt,
    label: 'Updating',
    unit: 'files',
    detail: chalk.hex('#888899')(`${added + updated + moved} entries updated`)
  });

const outputUpdateSummary = summary =>
  logger.info(
    section(`Database update (${summary.target})`, [
      ['scanned', `${summary.scanned}`],
      ['unchanged', `${summary.unchanged}`],
      ['added', `${summary.added}`],
      ['updated', `${summary.updated}`],
      ['moved', `${summary.moved}`],
      ['removed', `${summary.removed}`],
      ['failed', `${summary.failed}`],
      ['time', `${summary.seconds.toFixed(1)}s`]
    ])
  );

const outputDbStats = stats => {
  const { lastUpdate, lastBackup } = stats;
  const pairs = [
    ['path', stats.path],
    ['size', formatBytes(stats.size)],
    ['schema', `${stats.schemaVersion}`],
    ['songs', `${stats.songs}`],
    ['rated', `${stats.rated}`],
    ['duration', formatDuration(stats.duration)],
    ['tag values', `${stats.tagValues}`],
    ['frames', `${stats.frames}`],
    ['tag definitions', `${stats.tagDefinitions}`],
    ['last update', lastUpdate ? `${lastUpdate.at} (${formatUpdateCounts(lastUpdate)})` : 'never'],
    ['last backup', lastBackup ? `${lastBackup.at} (${lastBackup.file})` : 'never']
  ];
  return consoleLog(section('Database', pairs));
};

module.exports = { formatProgress, outputDbStats, outputUpdateSummary };
