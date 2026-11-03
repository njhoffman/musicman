const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { readTagBuffer, readTagBufferAsync } = require('./tagBuffer.js');

describe('ID3v2 tag buffer', () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-tag-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // an ID3v2.3 header for a tag of size body bytes, then the body and some audio
  const write = (name, body, audio = Buffer.alloc(64, 0xff)) => {
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, body.length]);
    const file = path.join(directory, name);
    fs.writeFileSync(file, Buffer.concat([header, body, audio]));
    return file;
  };

  it('should read the tag at the start of a file, header included, without the audio', async () => {
    const file = write('tagged.mp3', Buffer.alloc(20, 1));
    const tag = readTagBuffer(file);
    expect(tag.length).to.equal(30);
    expect(tag.toString('latin1', 0, 3)).to.equal('ID3');
    expect((await readTagBufferAsync(file)).equals(tag)).to.equal(true);
  });

  it('should be null for a file without an ID3v2 tag at its start, or too short for one', async () => {
    const plain = path.join(directory, 'plain.mp3');
    fs.writeFileSync(plain, Buffer.alloc(64, 0xff));
    const short = path.join(directory, 'short.mp3');
    fs.writeFileSync(short, Buffer.from('ID3'));
    expect(readTagBuffer(plain)).to.equal(null);
    expect(await readTagBufferAsync(plain)).to.equal(null);
    expect(await readTagBufferAsync(short)).to.equal(null);
  });

  it('should give the same frames to node-id3 as the whole file does', async () => {
    const NodeId3 = require('node-id3');
    const file = path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3');
    const whole = NodeId3.read(file).raw;
    expect(NodeId3.read(await readTagBufferAsync(file)).raw).to.deep.equal(whole);
  });
});
