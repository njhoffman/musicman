const PrettyError = require('pretty-error');
const logger = require('./logger');

const { NODE_ENV } = process.env;
const pe = new PrettyError();

pe.skipPackage('express', 'chai');

const exceptionHandler = err => {
  if (NODE_ENV !== 'TEST') {
    logger.error({ err });
    logger.error('\n\n   ** Unhandled Exception **\n', pe.render(err), '\n');
    throw new Error(err);
  }
};

const rejectionHandler = reason => {
  if (NODE_ENV !== 'TEST') {
    logger.error({ err: reason });
    logger.error('\n\n   ** Unhandled Rejection **\n', pe.render(reason), '\n');
    throw new Error(reason);
  }
};

const routeError = (err, req, res, next) => {
  if (!(err instanceof Error)) {
    logger.error({ routeError: err }, 'A non error-type was caught by the route error handler');
  } else if (err.name === 'AuthenticationError') {
    logger.warn(`Authentication error trying to reach: ${req.url}`);
  } else if (err.status === 200) {
    // expected errors (exceptions)
    logger.warn({ err }, `${err.name}: ${req.url} => ${err.message}`);
  } else {
    logger.error({ err }, `\n\nA routing error was encountered trying to access: ${req.url}`);
    /* eslint-disable no-console */
    console.error(
      `\n\n------\nRouting Error (${err.name}): ${req.url}\n`,
      err.body ? `\n Request Body:\n` : '',
      err.body ? err.body : '',
      err.body ? '\n\n' : '\n',
      pe.render(err),
      '------\n\n'
    );
    /* eslint-enable no-console */
  }

  if (!res.headersSent) {
    const status = err.status || 500;
    logger.info(`Sending headers from error handler with status ${status}`);
    res.status(status).json({
      error: `${err.name}: ${err.message}`,
      status: err.status
    });
  }
};

module.exports = { exceptionHandler, rejectionHandler, routeError };
