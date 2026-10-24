const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { artistImageDirectory, artistImageFile, cacheArtistImages } = require('./images.js');

describe('Spotify Artist Images', () => {
  let directory;
  const artist = (id, url) => ({ id, images: url ? [{ url, width: 640 }, { url: 'small' }] : [] });
  const fakeFetch = answers => {
    const urls = [];
    const fetchImpl = async url => {
      urls.push(url);
      const body = answers[url];
      return body
        ? { ok: true, status: 200, arrayBuffer: async () => Buffer.from(body) }
        : { ok: false, status: 404 };
    };
    return { urls, fetchImpl };
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-images-'));
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('should default to the musicman artists directory in XDG_CACHE_HOME', () => {
    expect(artistImageDirectory({}, { XDG_CACHE_HOME: '/cache' })).to.equal(
      '/cache/musicman/artists'
    );
    expect(artistImageDirectory({ spotify: { artistImageDirectory: '/photos' } })).to.equal(
      '/photos'
    );
  });

  it('should save the largest photo of each artist once', async () => {
    const { urls, fetchImpl } = fakeFetch({ big: 'jpeg-bytes' });
    const result = await cacheArtistImages({
      artists: [artist('a1', 'big'), artist('a1', 'big'), artist('a2')],
      directory,
      fetchImpl
    });
    expect(result).to.deep.equal({ saved: ['a1'], failed: [] });
    expect(urls).to.deep.equal(['big']);
    expect(fs.readFileSync(artistImageFile(directory, 'a1'), 'utf8')).to.equal('jpeg-bytes');
    // already cached, nothing is fetched again
    const again = await cacheArtistImages({ artists: [artist('a1', 'big')], directory, fetchImpl });
    expect(again.saved).to.be.empty;
    expect(urls).to.have.length(1);
  });

  it('should report a failed download without stopping or leaving a partial file', async () => {
    const { fetchImpl } = fakeFetch({ ok: 'bytes' });
    const result = await cacheArtistImages({
      artists: [artist('gone', 'missing'), artist('here', 'ok')],
      directory,
      fetchImpl
    });
    expect(result.saved).to.deep.equal(['here']);
    expect(result.failed).to.deep.equal([{ id: 'gone', error: 'HTTP 404' }]);
    expect(fs.readdirSync(directory)).to.deep.equal(['here.jpg']);
  });
});
