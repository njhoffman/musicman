const PrettyError = require('pretty-error');

const { NODE_ENV } = process.env;
const pe = new PrettyError();

pe.skipPackage('express', 'chai');

const exceptionHandler = err => {
  if (NODE_ENV !== 'TEST') {
    console.log({ err });
    console.log('\n\n   ** Unhandled Exception **\n', pe.render(err), '\n');
    throw new Error(err);
  }
};

const rejectionHandler = reason => {
  if (NODE_ENV !== 'TEST') {
    console.log({ err: reason });
    console.log('\n\n   ** Unhandled Rejection **\n', pe.render(reason), '\n');
    throw new Error(reason);
  }
};

module.exports = { exceptionHandler, rejectionHandler };
