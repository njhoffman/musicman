const { expect } = require('chai');
const { createClient } = require('./api.js');

describe('Spotify API Client', () => {
  // fetch answering each call with the next of responses: { status, body, retryAfter } or an Error
  const fakeFetch = responses => {
    const calls = [];
    const impl = async (url, options) => {
      calls.push({ url, options });
      const next = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (next instanceof Error) {
        throw next;
      }
      return {
        status: next.status,
        ok: next.status < 400,
        headers: { get: name => (name === 'retry-after' ? next.retryAfter : null) },
        text: async () => (next.body === undefined ? '' : JSON.stringify(next.body))
      };
    };
    return { impl, calls };
  };
  const client = (responses, options = {}) => {
    const fetch = fakeFetch(responses);
    const waits = [];
    const slept = [];
    return {
      fetch,
      waits,
      slept,
      api: createClient({
        getToken: async () => 'token',
        fetchImpl: fetch.impl,
        sleep: async ms => slept.push(ms),
        onWait: (seconds, reason) => waits.push([seconds, reason]),
        ...options
      })
    };
  };

  it('should return the JSON body and send the token with a timeout', async () => {
    const { api, fetch } = client([{ status: 200, body: { id: 'me' } }]);
    expect(await api.get('/me')).to.deep.equal({ id: 'me' });
    expect(fetch.calls[0].url).to.equal('https://api.spotify.com/v1/me');
    expect(fetch.calls[0].options.headers.Authorization).to.equal('Bearer token');
    expect(fetch.calls[0].options.signal).to.be.an.instanceOf(AbortSignal);
  });

  it('should wait a short Retry-After and report the wait', async () => {
    const { api, waits, slept } = client([
      { status: 429, retryAfter: '3' },
      { status: 200, body: { ok: true } }
    ]);
    expect(await api.get('/search')).to.deep.equal({ ok: true });
    expect(waits).to.deep.equal([[3, 'rate limited']]);
    expect(slept).to.deep.equal([3000]);
  });

  it('should throw a rate limit error instead of waiting a long Retry-After', async () => {
    const { api, slept } = client([{ status: 429, retryAfter: '16396' }]);
    const err = await api.get('/search').catch(error => error);
    expect(err).to.include({ rateLimited: true, retryAfter: 16396 });
    expect(slept).to.be.empty;
  });

  it('should retry timeouts and network errors, then fail with the reason', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const { api, waits } = client([timeout, new Error('ECONNRESET'), { status: 200, body: 1 }]);
    expect(await api.get('/tracks')).to.equal(1);
    expect(waits.map(([, reason]) => reason)).to.deep.equal(['timed out after 15s', 'ECONNRESET']);

    const failing = client([timeout], { retries: 1 });
    const err = await failing.api.get('/tracks').catch(error => error);
    expect(err.message).to.equal('Spotify API GET /tracks timed out after 15s');
    expect(failing.fetch.calls).to.have.length(2);
  });

  it('should back off exponentially on server errors', async () => {
    const { api, slept } = client([{ status: 502 }, { status: 503 }, { status: 200, body: 1 }]);
    expect(await api.get('/x')).to.equal(1);
    expect(slept).to.deep.equal([500, 1000]);
  });

  it('should explain errors whose body has no message', async () => {
    const { api } = client([{ status: 403, body: { error: { status: 403 } } }]);
    const err = await api.get('/audio-features/1').catch(error => error);
    expect(err.message).to.equal('Spotify API GET /audio-features/1 failed (403): {"status":403}');
  });

  it('should space requests to requestsPerSecond', async () => {
    let time = 0;
    const slept = [];
    const api = createClient({
      getToken: async () => 'token',
      fetchImpl: fakeFetch([{ status: 200, body: 1 }]).impl,
      requestsPerSecond: 4,
      now: () => time,
      sleep: async ms => {
        slept.push(ms);
        time += ms;
      }
    });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(slept).to.deep.equal([250, 250]);
  });
});
