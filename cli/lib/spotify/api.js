const _ = require('lodash');

const apiUrl = 'https://api.spotify.com/v1';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Spotify Web API client. Requests that are rate limited (429) or hit a server error (5xx) are
 * retried, waiting Retry-After when Spotify sends it, otherwise backing off exponentially.
 */
const createClient = ({
  getToken,
  fetchImpl = fetch,
  retries = 4,
  sleep = wait,
  baseDelayMs = 500
}) => {
  const request = async (method, url, body) => {
    const fullUrl = url.startsWith('http') ? url : `${apiUrl}${url}`;
    for (let attempt = 0; ; attempt += 1) {
      const token = await getToken();

      const res = await fetchImpl(fullUrl, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));

        await sleep(retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt);
      } else {
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) {
          const error = json && json.error;
          // errors come as { error: { status, message } }, { error: 'code' }, or { message }
          const message =
            (_.isPlainObject(error) ? error.message || JSON.stringify(error) : error) ||
            (json && json.message);
          const err = new Error(
            `Spotify API ${method} ${url} failed (${res.status}): ${message || 'no details'}`
          );
          err.status = res.status;
          throw err;
        }
        return json;
      }
    }
  };

  // every item of a paged endpoint, following next links
  const paginate = async url => {
    const items = [];
    let next = url;
    while (next) {
      const page = await request('GET', next);
      items.push(...page.items);
      next = page.next;
    }
    return items;
  };

  return { request, get: url => request('GET', url), paginate };
};

module.exports = { createClient };
