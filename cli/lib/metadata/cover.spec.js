const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  coverDownloader,
  coverState,
  defaultCover,
  defaultCoverFrame,
  downloadCover,
  embeddedCover,
  replaceable,
  spotifyCoverDescription
} = require('./cover.js');

describe('Covers', () => {
  let dir;
  let config;
  const placeholder = Buffer.from('the default image');
  const image = (buffer, description = '') => ({
    mime: 'image/jpeg',
    description,
    imageBuffer: buffer
  });
  const response = (buffer, ok = true) => ({
    ok,
    status: ok ? 200 : 404,
    headers: { get: () => 'image/png; charset=binary' },
    arrayBuffer: async () => buffer
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-cover-'));
    fs.writeFileSync(path.join(dir, 'default.jpg'), placeholder);
    config = { library: { defaultCover: path.join(dir, 'default.jpg') } };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('should read the default cover, and have none when it is not set or missing', () => {
    expect(defaultCover(config)).to.include({ mime: 'image/jpeg' });
    expect(defaultCover(config).buffer.equals(placeholder)).to.equal(true);
    expect(defaultCover({})).to.equal(null);
    expect(defaultCover({ library: { defaultCover: path.join(dir, 'gone.jpg') } })).to.equal(null);
    expect(defaultCoverFrame(config)).to.deep.include({
      mime: 'image/jpeg',
      type: { id: 3, name: 'front cover' }
    });
    expect(defaultCoverFrame({})).to.equal(null);
  });

  it('should read the default cover again when the file changes', () => {
    const other = Buffer.from('a new default image, longer');
    fs.writeFileSync(config.library.defaultCover, other);
    fs.utimesSync(config.library.defaultCover, new Date(), new Date(Date.now() + 5000));
    expect(defaultCover(config).buffer.equals(other)).to.equal(true);
  });

  it('should tell no cover, the default image, a Spotify cover, and artwork of its own', () => {
    expect(coverState(null, config)).to.equal('none');
    expect(coverState(image(placeholder), config)).to.equal('default');
    expect(coverState(image(Buffer.from('x'), spotifyCoverDescription), config)).to.equal(
      'spotify'
    );
    expect(coverState(image(Buffer.from('x')), config)).to.equal('own');
    // without a default cover, the placeholder is just artwork
    expect(coverState(image(placeholder), {})).to.equal('own');
    expect(['none', 'default', 'spotify', 'own'].filter(replaceable)).to.deep.equal([
      'none',
      'default'
    ]);
  });

  it('should read the embedded cover of a file, null without one or for an unreadable file', () => {
    const readTags = () => ({ image: image(placeholder) });
    expect(embeddedCover('a.mp3', { readTags }).imageBuffer.equals(placeholder)).to.equal(true);
    expect(embeddedCover('a.mp3', { readTags: () => ({}) })).to.equal(null);
    expect(
      embeddedCover('a.mp3', {
        readTags: () => {
          throw new Error('unreadable');
        }
      })
    ).to.equal(null);
  });

  it('should download a cover marked as from Spotify, each URL once, failures as null', async () => {
    const cover = await downloadCover('https://i/1', async () => response(Buffer.from('png')));
    expect(cover).to.deep.include({ mime: 'image/png', description: spotifyCoverDescription });
    let error = null;
    await downloadCover('https://i/2', async () => response(null, false)).catch(err => {
      error = err;
    });
    expect(error.message).to.equal('cover https://i/2: HTTP 404');

    const calls = [];
    const download = coverDownloader(async url => {
      calls.push(url);
      return response(Buffer.from(url), url !== 'https://i/bad');
    });
    expect((await download('https://i/1')).imageBuffer.toString()).to.equal('https://i/1');
    await download('https://i/1');
    expect(await download('https://i/bad')).to.equal(null);
    expect(calls).to.deep.equal(['https://i/1', 'https://i/bad']);
  });
});
