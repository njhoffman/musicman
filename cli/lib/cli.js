const PrettyError = require('pretty-error');
const { loadConfig } = require('musicman-common/config');

const commandParser = require('./parser/index.js');
const { getAvailableSong } = require('./clients/mpd.js');
const { helpOutput } = require('./help.js');
const logger = require('./utils/logger.js');
const { archives, finishRun, startRun } = require('./utils/runs.js');
const { version } = require('../../package.json');

const pe = new PrettyError();

const run = async args => {
  // help and version work before (and without) a config
  const help = helpOutput(args, version);
  if (help !== null) {
    process.stdout.write(`${help}\n`);
    return;
  }

  const config = loadConfig({ create: true });
  logger.configure(config.output);
  logger.configureLogFile(config.logger.file);
  logger.configureColors(config.logger.colors);

  const currentSong = await getAvailableSong(config.mpd);
  const { command, target, options } = commandParser({ args, currentSong, config });

  if (!target) {
    throw new Error('No target specified, see musicman --help');
  }

  const run = archives(command, options.switches)
    ? startRun({ command: command.name, args, config })
    : null;
  let result;
  let error;
  // a run stopped with ctrl-c or a signal is still archived, as interrupted
  const interrupt = signal => {
    logger.progressDone();
    logger.logToFile('warn', `Interrupted by ${signal}`);
    finishRun(run, { config, interrupted: true, exitCode: 130 });
    process.exit(130);
  };
  if (run) {
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
  }
  try {
    result = await command.func({
      target,
      options: { ...options, commandName: command.name },
      config
    });
  } catch (err) {
    error = err;
    logger.logToFile('error', err.stack || err.message);
    throw err;
  } finally {
    if (run) {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      finishRun(run, { config, result, error, exitCode: process.exitCode || 0 });
    }
  }
};

run(process.argv.slice(2));

process.on('unhandledRejection', err => {
  logger.error(`Unhandled Rejection ${err.name}: ${err.message}\n`, pe.render(err));
  // console.error(err);
  process.exit(1);
});

process.on('uncaughtException', err => {
  logger.error(`Unhandled Exception ${err.name}: ${err.message}\n`, pe.render(err));
  // console.error(err);
  process.exit(1);
});
