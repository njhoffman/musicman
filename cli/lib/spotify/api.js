const _ = require('lodash');

const apiUrl = 'https://api.spotify.com/v1';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// a 429 whose Retry-After is too long to wait for, e.g. Spotify's multi-hour app bans
class RateLimitError extends Error {
  constructor(retryAfter) {
    super(`Spotify rate limit reached, retry after ${retryAfter}s`);
    this.rateLimited = true;
    this.retryAfter = retryAfter;
  }
}

/**
 * Spotify Web API client. Requests are spaced to at most requestsPerSecond and time out after
 * timeoutMs. Timeouts, network errors, rate limits (429), and server errors (5xx) are retried, waiting
 * Retry-After when Spotify sends it, otherwise backing off exponentially; onWait(seconds, reason) is
 * called before each wait. A Retry-After longer than maxRetryAfter seconds throws a RateLimitError
 * instead of waiting.
 */
const createClient = ({
  getToken,
  fetchImpl = fetch,
  retries = 4,
  sleep = wait,
  baseDelayMs = 500,
  timeoutMs = 15000,
  maxRetryAfter = 60,
  requestsPerSecond = 0,
  now = Date.now,
  onWait = _.noop
}) => {
  // start time of the next request, every request takes the next free slot
  let nextSlot = 0;
  const throttle = async () => {
    if (!requestsPerSecond) {
      return;
    }
    const slot = Math.max(now(), nextSlot);
    nextSlot = slot + 1000 / requestsPerSecond;
    if (slot > now()) {
      await sleep(slot - now());
    }
  };

  const backoff = async (attempt, seconds, reason) => {
    const delay = seconds > 0 ? seconds * 1000 : baseDelayMs * 2 ** attempt;
    onWait(delay / 1000, reason);
    await sleep(delay);
  };

  const request = async (method, url, body) => {
    const fullUrl = url.startsWith('http') ? url : `${apiUrl}${url}`;
    for (let attempt = 0; ; attempt += 1) {
      await throttle();
      const token = await getToken();
      let res;
      try {
        res = await fetchImpl(fullUrl, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
        const reason = timedOut ? `timed out after ${timeoutMs / 1000}s` : err.message;
        if (attempt >= retries) {
          throw new Error(`Spotify API ${method} ${url} ${reason}`, { cause: err });
        }
        await backoff(attempt, 0, reason);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        if (res.status === 429 && retryAfter > maxRetryAfter) {
          throw new RateLimitError(retryAfter);
        }
        if (attempt < retries) {
          await backoff(attempt, retryAfter, res.status === 429 ? 'rate limited' : `${res.status}`);
          continue;
        }
      }
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

module.exports = { RateLimitError, createClient };
