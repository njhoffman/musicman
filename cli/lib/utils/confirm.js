const inquirerConfirm = require('@inquirer/confirm').default;

/**
 * Asks a yes/no question on the terminal, defaulting to no. Ctrl+C or a closed stdin answers no
 * instead of throwing, so callers only handle true and false.
 */
const confirm = async (message, { prompt = inquirerConfirm } = {}) => {
  try {
    return await prompt({ message, default: false });
  } catch (err) {
    if (err && err.name === 'ExitPromptError') {
      return false;
    }
    throw err;
  }
};

module.exports = { confirm };
