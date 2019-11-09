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

const routeError = (err, req, res, next) => {
  if (!(err instanceof Error)) {
    console.log({ routeError: err }, 'A non-error was caught by the route error handler');
  } else if (err.name === 'AuthenticationError') {
    console.log(`Authentication error trying to reach: ${req.url}`);
  } else if (err.status === 200) {
    // expected errors (exceptions) i.e. previously valid appointment becoming invalid because of occupied time slot
    console.log({ err }, `${err.name}: ${req.url} => ${err.message}`);
    // console.log(`\n${err.name}: ${req.url} => ${err.message}\n`);
  } else {
    console.log({ err }, `\n\nA routing error was encountered trying to access: ${req.url}`);
    console.error(
      `\n\n------\nRouting Error (${err.name}): ${req.url}\n`,
      err.body ? `\n Request Body:\n` : '',
      err.body ? err.body : '',
      err.body ? '\n\n' : '\n',
      pe.render(err),
      '------\n\n'
    );
  }

  if (!res.headersSent) {
    const status = err.status || 500;
    info(`Sending headers from error handler with status ${status}`);
    res.status(status).json({
      error: `${err.name}: ${err.message}`,
      status: err.status
    });
  }
};

module.exports = { exceptionHandler, rejectionHandler, routeError };
