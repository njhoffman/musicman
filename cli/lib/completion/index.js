const _ = require('lodash');

const { completionModel } = require('./model.js');
const { renderZsh } = require('./zsh.js');

const renderers = { zsh: renderZsh };
const shells = _.keys(renderers);

// handled before the config loads like --help, listed with the commands in help
const completionCommand = {
  name: 'completion',
  description:
    'Print a shell completion script: musicman completion zsh > ~/.zsh/completions/_musicman',
  usage: `musicman completion <${shells.join(' | ')}>`
};

/**
 * The completion script when args are musicman completion <shell>, otherwise null. fields() gives the
 * field names to complete and is only called when a script is generated. Throws for a missing or
 * unknown shell.
 */
const completionOutput = (args, { version, fields }) => {
  if (args[0] !== completionCommand.name) {
    return null;
  }
  const render = renderers[args[1]];
  if (!render) {
    throw new Error(`musicman completion takes a shell: ${shells.join(', ')}`);
  }
  return render(completionModel({ fields: fields(), shells, completionCommand }), { version });
};

module.exports = { completionCommand, completionOutput, shells };
