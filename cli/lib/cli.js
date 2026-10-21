const PrettyError = require('pretty-error');
const { loadConfig } = require('musicman-common/config');

const commandParser = require('./parser/index.js');
const { getAvailableSong } = require('./clients/mpd.js');
const { helpOutput } = require('./help.js');
const parseSwitches = require('./parser/options/switches.js');
const { outputFormat } = require('./output/formats.js');
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
  // data formats own stdout, so log messages (including the parser's) go to stderr
  if (outputFormat(parseSwitches(args, config).switches) !== 'default') {
    logger.configure({ stream: 'stderr' });
  }
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
  // a run stopped with ctrl-c, a signal, or a closed terminal is still archived, as interrupted
  const interrupt = signal => {
    logger.progressDone();
    logger.logToFile('warn', `Interrupted by ${signal}`);
    finishRun(run, { config, interrupted: true, exitCode: 130 });
    process.exit(130);
  };
  // SIGHUP comes when the terminal is closed
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  if (run) {
    signals.forEach(signal => process.once(signal, interrupt));
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
      signals.forEach(signal => process.removeListener(signal, interrupt));
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
