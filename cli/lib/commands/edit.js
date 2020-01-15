const parseOptions = options => {
  console.log('OPTIONS', options);
};

const editCommand = async ({ target, options, config }) => {
  console.log('Edit command', options);
};

module.exports = { name: 'edit', func: editCommand, _test: { parseOptions } };
