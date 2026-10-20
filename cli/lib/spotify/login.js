const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

const { authorizeUrl, exchangeCode, writeTokens } = require('./auth.js');

const page = message =>
  `<!doctype html><html><body style="font-family: sans-serif"><p>${message}</p></body></html>`;

// open the url in the desktop browser, ignoring failures (the url is also printed)
const openBrowser = url => {
  try {
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch (err) {
    // the printed url is the fallback
  }
};

/**
 * Spotify authorization code login. Listens on the redirect URI (an http loopback address), sends
 * the user to Spotify, exchanges the returned code for tokens, and saves them to file.
 */
const login = ({
  credentials,
  file,
  onUrl,
  open = openBrowser,
  fetchImpl,
  timeoutMs = 5 * 60 * 1000
}) => {
  const redirect = new URL(credentials.redirectUri);
  if (
    redirect.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname)
  ) {
    return Promise.reject(
      new Error(
        `Redirect URI ${credentials.redirectUri} must be an http loopback address, e.g. http://127.0.0.1:6659/callback`
      )
    );
  }
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    let timer;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, credentials.redirectUri);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const finish = (status, message, err, tokens) => {
        res.writeHead(status, { 'Content-Type': 'text/html' }).end(page(message));
        clearTimeout(timer);
        server.close();
        if (err) {
          reject(err);
        } else {
          resolve(tokens);
        }
      };
      if (url.searchParams.get('state') !== state) {
        finish(
          400,
          'Login failed: state did not match, start the login again.',
          new Error('Spotify login state did not match')
        );
      } else if (url.searchParams.get('error')) {
        finish(
          400,
          'Login was cancelled.',
          new Error(`Spotify login failed: ${url.searchParams.get('error')}`)
        );
      } else {
        try {
          const tokens = await exchangeCode(credentials, url.searchParams.get('code'), {
            fetchImpl
          });
          writeTokens(file, tokens);
          finish(200, 'Logged in to Spotify, you can close this tab.', null, tokens);
        } catch (err) {
          finish(500, 'Login failed while exchanging the code, see the terminal.', err);
        }
      }
    });

    server.on('error', reject);
    server.listen(Number(redirect.port) || 80, redirect.hostname.replace(/^\[|\]$/g, ''), () => {
      const url = authorizeUrl(credentials, state);
      onUrl(url);
      open(url);
      timer = setTimeout(() => {
        server.close();
        reject(new Error('Timed out waiting for the Spotify login'));
      }, timeoutMs);
    });
  });
};

module.exports = { login };
