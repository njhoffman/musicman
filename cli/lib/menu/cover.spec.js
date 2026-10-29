const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { coverFor, folderCover, localCover, remoteCover } = require('./cover.js');

describe('Menu covers', () => {
  let directory;
  let cache;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-cover-'));
    cache = path.join(directory, 'cache');
    fs.writeFileSync(path.join(directory, 'song.mp3'), 'mp3');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const song = () => path.join(directory, 'song.mp3');

  it('should save the embedded picture once per file version', () => {
    let reads = 0;
    const readTags = () => {
      reads += 1;
      return { image: { mime: 'image/png', imageBuffer: Buffer.from('png') } };
    };
    const first = localCover(song(), cache, { readTags });
    expect(path.extname(first)).to.equal('.png');
    expect(fs.readFileSync(first, 'utf8')).to.equal('png');
    expect(localCover(song(), cache, { readTags })).to.equal(first);
    expect(reads).to.equal(1);
  });

  it('should fall back to a cover image in the song folder, matched case-insensitively', () => {
    fs.writeFileSync(path.join(directory, 'Folder.JPG'), 'jpg');
    fs.writeFileSync(path.join(directory, 'cover.png'), 'png');
    expect(folderCover(song())).to.equal(path.join(directory, 'cover.png'));
    expect(localCover(song(), cache, { readTags: () => ({}) })).to.equal(
      path.join(directory, 'cover.png')
    );
    expect(localCover(path.join(directory, 'missing.mp3'), cache)).to.equal(null);
  });

  it('should download a Spotify cover once, and give up quietly when it cannot', async () => {
    const urls = [];
    const fetchImpl = async url => {
      urls.push(url);
      return { ok: true, arrayBuffer: async () => Buffer.from('jpg') };
    };
    const url = 'https://i.scdn.co/image/ab67616d0000b273';
    const file = await remoteCover(url, cache, { fetchImpl });
    expect(fs.readFileSync(file, 'utf8')).to.equal('jpg');
    expect(await remoteCover(url, cache, { fetchImpl })).to.equal(file);
    expect(urls).to.have.length(1);
    const failing = async () => {
      throw new Error('offline');
    };
    expect(
      await remoteCover('https://i.scdn.co/image/other', cache, { fetchImpl: failing })
    ).to.equal(null);
    expect(await remoteCover('https://example.com/x.jpg', cache, { fetchImpl })).to.equal(null);
  });

  it('should prefer the local file of a song over the Spotify cover', async () => {
    fs.writeFileSync(path.join(directory, 'cover.jpg'), 'jpg');
    const fetchImpl = async () => expect.fail('should not download');
    const track = { artUrl: 'https://i.scdn.co/image/abc' };
    expect(
      await coverFor(track, { file: song(), directory: cache, fetchImpl, readTags: () => ({}) })
    ).to.equal(path.join(directory, 'cover.jpg'));
    expect(await coverFor(null)).to.equal(null);
  });
});
