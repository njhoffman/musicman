const _ = require('lodash');
const chalk = require('chalk').default;

const commands = require('./commands/index.js');
const switchMap = require('./parser/options/switchMap.js');
const globalSwitches = require('./parser/options/globalSwitches.js');
const { completionCommand } = require('./completion/index.js');

const helpArgs = ['--help', '-h'];
const versionArgs = ['--version', '-V'];

// chalk drops the colors when the output is not a terminal
const heading = text => chalk.hex('#8888FF').bold(text);
const commandName = text => chalk.hex('#55BBDD')(text);
const switchName = text => chalk.hex('#7FB8A8')(text);
const placeholder = text => chalk.hex('#A0A8C8')(text);

const switchLabel = text => switchName(text.replace(/<[^>]+>/g, placeholder));

// narrower than this, wrapping would leave a word or two a line: the terminal wraps it instead
const minTextWidth = 20;

// lines of at most width characters; a word too long for a line breaks after its commas (a list of
// values), one with none stays whole; no width (piped output) leaves one line
const wrapText = (text, width) => {
  if (!width || width < minTextWidth || text.length <= width) {
    return [text];
  }
  const lines = [];
  let line = '';
  _.each(_.compact(text.split(/\s+/)), word => {
    const pieces = word.length > width ? word.split(/(?<=,)/) : [word];
    _.each(pieces, (piece, i) => {
      const separator = line && i === 0 ? ' ' : '';
      if (line && line.length + separator.length + piece.length > width) {
        lines.push(line);
        line = piece;
      } else {
        line = `${line}${separator}${piece}`;
      }
    });
  });
  return [...lines, line];
};

// a heading line: wrapped under a small indent, its label painted
const titled = (label, paint, text, width) => {
  const lines = _.flatMap(`${label}${text}`.split('\n'), line =>
    wrapText(line, width ? width - 2 : null).map((part, i) => (i > 0 ? `  ${part}` : part))
  );
  return lines.join('\n').replace(label, () => paint(label));
};

// padded by the plain text, escape codes have no width; descriptions wrap to their column
const columns = (rows, paint, width) => {
  const labelWidth = _.max(_.map(rows, ([left]) => left.length)) || 0;
  const indent = ' '.repeat(labelWidth + 4);
  return _.map(rows, ([left, right]) => {
    const text = wrapText(right, width ? width - indent.length : null).join(`\n${indent}`);
    return `  ${paint(left)}${' '.repeat(labelWidth - left.length)}  ${text}`;
  }).join('\n');
};

// a command's own wording replaces the description shared by every command with the switch
const switchRows = (names, overrides = {}) =>
  _.map(names, name => {
    const { alias, value, description: shared } = switchMap[name] || globalSwitches[name];
    const description = overrides[name] || shared;
    return value
      ? [`--${name}=<${value}>, ${alias} <${value}>`, description]
      : [`--${name}, ${alias}`, description];
  });

// overview of every command and switch
const generalHelp = (version, width) =>
  [
    titled(
      `musicman ${version}`,
      chalk.bold,
      ': mp3 library manager for MPD, beets, and Spotify',
      width
    ),
    '',
    titled(
      'Usage:',
      heading,
      ' musicman [command] [target] [field:value ...] [field=value ...] [switches]',
      width
    ),
    '',
    heading('Commands (view when none is given):'),
    columns(
      _.map([...commands, completionCommand], ({ name, description }) => [name, description]),
      commandName,
      width
    ),
    '',
    heading('Filters and assignments:'),
    columns(
      [
        [
          'field:value',
          'only files whose field contains value (~field:value excludes, field: means empty)'
        ],
        [
          'rating:4.5',
          'rating 4.5 or higher, rating:3-4 for a range, a bare number filters ratings'
        ],
        [
          'field=value',
          'assign a value (edit), field=a,b for multi value fields, +a,-b to add or remove'
        ]
      ],
      placeholder,
      width
    ),
    '',
    heading('Switches:'),
    columns(switchRows([..._.keys(switchMap), ..._.keys(globalSwitches)]), switchLabel, width)
  ].join('\n');

// one command's usage and the switches it uses
const commandHelp = (command, width) =>
  [
    titled(`musicman ${command.name}`, chalk.bold, `: ${command.description}`, width),
    '',
    titled('Usage:', heading, ` ${command.usage}`, width),
    ...(command.switches && command.switches.length > 0
      ? [
          '',
          heading('Switches:'),
          columns(switchRows(command.switches, command.switchHelp), switchLabel, width)
        ]
      : [])
  ].join('\n');

/**
 * Help or version text when args ask for it, otherwise null. With a command name before --help, that
 * command's help. Lines wrap to width, the terminal's; without one each entry stays on one line.
 */
const helpOutput = (args, version, { width = null } = {}) => {
  if (_.some(args, arg => versionArgs.includes(arg))) {
    return version;
  }
  if (!_.some(args, arg => helpArgs.includes(arg))) {
    return null;
  }
  const command = _.find([...commands, completionCommand], { name: args[0] });
  return command ? commandHelp(command, width) : generalHelp(version, width);
};

module.exports = { helpOutput };
