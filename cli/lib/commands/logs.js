const _ = require('lodash');
const fs = require('fs');
const { spawnSync } = require('child_process');

const { emitFormatted } = require('../output/emit.js');
const { outputFormat } = require('../output/formats.js');
const { previewCommand } = require('../output/fzf.js');
const { outputRun, outputRunList, runOneline, runRecords } = require('../output/logs.js');
const { listRuns, runFiles, runsDirectory } = require('../utils/runs.js');
const logger = require('../utils/logger.js');

// long output goes through $PAGER (less -R) on a terminal, straight to stdout otherwise
const page = (
  text,
  { isTTY = process.stdout.isTTY, env = process.env, spawn = spawnSync } = {}
) => {
  if (!isTTY) {
    process.stdout.write(`${text}\n`);
    return;
  }
  const result = spawn(env.PAGER || 'less -R', {
    shell: true,
    input: `${text}\n`,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  // the shell exits 127 for a pager it cannot find; a pager quit before the end (EPIPE) is fine
  if (result.status === 127 || (result.error && result.error.code !== 'EPIPE')) {
    process.stdout.write(`${text}\n`);
  }
};

// the run a term names: latest, a full id, or the newest run whose id starts with it
const findRun = (reports, term) => {
  if (term === 'latest') {
    return reports[0];
  }
  return _.find(reports, { id: term }) || _.find(reports, ({ id }) => id.startsWith(term));
};

// logs: list archived runs (logs sync lists one command); logs <id | id prefix | latest>: show one
const logsCommand = async ({ options, config, pager = page }) => {
  const directory = runsDirectory(config);
  const reports = listRuns(directory);
  const terms = options.terms || [];
  // required here, the command list includes this command
  const commandNames = _.map(require('./index.js'), 'name');
  const runTerm = _.find(terms, term => !commandNames.includes(term));

  if (runTerm) {
    const report = findRun(reports, runTerm);
    if (!report) {
      logger.error(`No archived run matches '${runTerm}', see musicman logs`);
      process.exitCode = 1;
      return { report: null };
    }
    const { logFile } = runFiles(directory, report.id);
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    pager(outputRun(report, log));
    return { report, logFile };
  }

  const filter = _.intersection(terms, commandNames);
  const shown =
    filter.length > 0 ? _.filter(reports, ({ command }) => filter.includes(command)) : reports;
  if (outputFormat(options.switches) !== 'default') {
    const { selected } = emitFormatted({
      switches: options.switches,
      config,
      title: 'musicman logs',
      records: runRecords(shown),
      columns: ['id', 'command', 'args', 'status', 'startedAt', 'seconds', 'summary'],
      oneline: runOneline,
      preview: previewCommand('logs')
    });
    return { runs: shown, selected };
  }
  logger.consoleLog(outputRunList(shown));
  return { runs: shown };
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  page,
  name: 'logs',
  description: 'List archived runs of commands that changed something, or show one run and its log',
  usage: 'musicman logs [command | run id | latest] [--format=<format> | --fzf]',
  switches: ['format', 'fzf'],
  func: logsCommand,
  defaultTarget,
  targetArgs: false
};
