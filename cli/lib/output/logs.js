const _ = require('lodash');
const chalk = require('chalk').default;

const { formatClock } = require('./progress.js');
const { renderColumns } = require('./render.js');
const { availableWidth } = require('../utils/logger.js');

const statusColors = {
  ok: '#55CC55',
  failed: '#DD4444',
  interrupted: '#DDCC44',
  running: '#55BBDD'
};
const levelColors = {
  ERROR: '#DD4444',
  WARN: '#DD7744',
  INFO: '#5588DD',
  DEBUG: '#8888AA',
  TRACE: '#666677'
};

const dim = text => chalk.hex('#888899')(text);
const statusText = status => chalk.hex(statusColors[status] || '#BBBBBB')(status || '?');

const countsText = (counts, names) =>
  _.compact(_.map(names, name => (counts[name] ? `${counts[name]} ${name}` : null))).join(', ');

/**
 * Short summary of what a run did, from the result its command returned: Spotify match counts,
 * database update counts, the number of edited files, and so on. Empty when nothing is known.
 */
const runSummary = report => {
  const result = _.get(report, 'result') || {};
  const summary = result.summary || {};
  if (report.error) {
    return report.error;
  }
  if (_.has(summary, 'match')) {
    return (
      countsText(summary, ['match', 'refresh', 'review', 'missing', 'failed']) || 'nothing to match'
    );
  }
  // sort also updates the database, its own counts come first
  if (_.isNumber(result.sorted)) {
    return `${result.sorted} sorted, ${result.failed || 0} failed`;
  }
  if (_.has(summary, 'scanned')) {
    return countsText(summary, ['added', 'updated', 'moved', 'removed', 'failed']) || 'unchanged';
  }
  if (result.backup) {
    return `backup ${result.backup.file}`;
  }
  if (result.plan) {
    const total = key => _.sumBy(result.plan, target => (target[key] || []).length);
    return `plan: ${total('add')} to add, ${total('prune')} to prune, ${total('pull')} to pull`;
  }
  if (_.isArray(result.newFiles)) {
    return `${result.newFiles.length} files edited`;
  }
  if (_.isArray(result.candidates)) {
    return `${result.candidates.length} songs to sort`;
  }
  return '';
};

const startedText = report =>
  report.startedAt ? new Date(report.startedAt).toLocaleString('sv-SE').slice(0, 16) : '?';

// list records of run reports for --format
const runRecords = reports =>
  _.map(reports, report => ({
    id: report.id,
    command: report.command,
    args: _.join(report.args, ' '),
    status: report.status,
    startedAt: report.startedAt,
    seconds: report.seconds,
    summary: runSummary(report)
  }));

// id<TAB>status started command args summary, for fzf
const runOneline = record =>
  `${record.id}\t${statusText(record.status).padEnd(22)} ${dim(startedText(record))} ${chalk.bold(
    record.args || record.command
  )} ${dim(record.summary)}`;

const outputRunList = reports => {
  if (reports.length === 0) {
    return 'No archived runs';
  }
  const rows = _.map(runRecords(reports), record => [
    record.id,
    record.status || '?',
    record.seconds === undefined ? '' : formatClock(record.seconds),
    record.args || record.command,
    record.summary
  ]);
  return renderColumns({
    head: ['Run', 'Status', 'Time', 'Command', 'Summary'],
    rows,
    columns: [
      {},
      { format: cell => cell.replace(cell.trim(), statusText(cell.trim())) },
      { align: 'right' },
      { maxWidth: 40 },
      { format: dim }
    ],
    splitter: '  ',
    maxLineWidth: availableWidth()
  });
};

// report header and the run log with colored levels
const outputRun = (report, log) => {
  const header = [
    `${chalk.bold(report.id)}  ${statusText(report.status)}${
      report.exitCode ? dim(` (exit ${report.exitCode})`) : ''
    }`,
    `${dim('command')}  musicman ${_.join(report.args, ' ')}`,
    `${dim('started')}  ${report.startedAt || '?'}${
      report.seconds === undefined ? '' : `  ${dim('took')} ${formatClock(report.seconds)}`
    }`,
    runSummary(report) ? `${dim('summary')}  ${runSummary(report)}` : ''
  ].filter(Boolean);
  const lines = (log || '').replace(/\n$/, '').split('\n');
  const colored = _.map(lines, line =>
    line.replace(
      /^(\S+) (ERROR|WARN|INFO|DEBUG|TRACE)/,
      (whole, time, level) => `${dim(time)} ${chalk.hex(levelColors[level])(level)}`
    )
  );
  return [...header, '', ...(log ? colored : [dim('(empty log)')])].join('\n');
};

module.exports = { outputRun, outputRunList, runOneline, runRecords, runSummary };
