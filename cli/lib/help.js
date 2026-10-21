const _ = require('lodash');

const commands = require('./commands/index.js');
const switchMap = require('./parser/options/switchMap.js');

// handled before the config loads, so they work without a config
const globalSwitches = {
  help: { alias: '-h', description: 'Show help, for a command with musicman <command> --help' },
  version: { alias: '-V', description: 'Show the musicman version' }
};

const helpArgs = ['--help', '-h'];
const versionArgs = ['--version', '-V'];

const columns = rows => {
  const width = _.max(_.map(rows, ([left]) => left.length)) || 0;
  return _.map(rows, ([left, right]) => `  ${left.padEnd(width)}  ${right}`).join('\n');
};

const switchRows = names =>
  _.map(names, name => {
    const { alias, description, value } = switchMap[name] || globalSwitches[name];
    return value
      ? [`--${name}=<${value}>, ${alias} <${value}>`, description]
      : [`--${name}, ${alias}`, description];
  });

// overview of every command and switch
const generalHelp = version =>
  [
    `musicman ${version}: mp3 library manager for MPD, beets, and Spotify`,
    '',
    'Usage: musicman [command] [target] [field:value ...] [field=value ...] [switches]',
    '',
    'Commands (view when none is given):',
    columns(_.map(commands, ({ name, description }) => [name, description])),
    '',
    'Filters and assignments:',
    columns([
      [
        'field:value',
        'only files whose field contains value (~field:value excludes, field: means empty)'
      ],
      ['rating:4.5', 'rating 4.5 or higher, rating:3-4 for a range, a bare number filters ratings'],
      [
        'field=value',
        'assign a value (edit), field=a,b for multi value fields, +a,-b to add or remove'
      ]
    ]),
    '',
    'Switches:',
    columns(switchRows([..._.keys(switchMap), ..._.keys(globalSwitches)]))
  ].join('\n');

// one command's usage and the switches it uses
const commandHelp = command =>
  [
    `musicman ${command.name}: ${command.description}`,
    '',
    `Usage: ${command.usage}`,
    ...(command.switches && command.switches.length > 0
      ? ['', 'Switches:', columns(switchRows(command.switches))]
      : [])
  ].join('\n');

/**
 * Help or version text when args ask for it, otherwise null. With a command name before --help, that
 * command's help.
 */
const helpOutput = (args, version) => {
  if (_.some(args, arg => versionArgs.includes(arg))) {
    return version;
  }
  if (!_.some(args, arg => helpArgs.includes(arg))) {
    return null;
  }
  const command = _.find(commands, { name: args[0] });
  return command ? commandHelp(command) : generalHelp(version);
};

module.exports = { helpOutput };
