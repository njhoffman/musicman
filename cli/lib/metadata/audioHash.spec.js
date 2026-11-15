const { expect } = require('chai');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');

const { audioHash, audioRange } = require('./audioHash.js');

describe('Audio hash', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-hash-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
  const write = (name, ...parts) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.concat(parts));
    return file;
  };
  // an ID3v2 header for a tag body of size bytes (syncsafe), with the footer flag when asked
  const id3v2 = (size, footer = false) => {
    const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, footer ? 0x10 : 0, 0, 0, 0, 0]);
    header[6] = (size >> 21) & 0x7f;
    header[7] = (size >> 14) & 0x7f;
    header[8] = (size >> 7) & 0x7f;
    header[9] = size & 0x7f;
    return Buffer.concat([
      header,
      Buffer.alloc(size, 7),
      footer ? Buffer.alloc(10, 3) : Buffer.alloc(0)
    ]);
  };
  const id3v1 = () => Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125, 1)]);
  // an APEv2 tag of items bytes, with its header when withHeader
  const ape = (items, withHeader) => {
    const footer = Buffer.alloc(32);
    footer.write('APETAGEX', 0, 'latin1');
    footer.writeUInt32LE(2000, 8);
    footer.writeUInt32LE(items + 32, 12);
    footer.writeUInt32LE(withHeader ? 0x80000000 : 0, 20);
    return Buffer.concat([
      withHeader ? Buffer.alloc(32, 5) : Buffer.alloc(0),
      Buffer.alloc(items, 6),
      footer
    ]);
  };
  const audio = Buffer.from('frames of audio, not tags');

  it('should hash the audio alone, without ID3v2, ID3v1 and APEv2 tags', async () => {
    const plain = await audioHash(write('plain.mp3', audio));
    expect(plain).to.equal(sha(audio));
    expect(await audioHash(write('v2.mp3', id3v2(300), audio))).to.equal(plain);
    expect(await audioHash(write('two.mp3', id3v2(20, true), id3v2(5), audio))).to.equal(plain);
    expect(await audioHash(write('v1.mp3', audio, id3v1()))).to.equal(plain);
    expect(await audioHash(write('ape.mp3', id3v2(40), audio, ape(50, true), id3v1()))).to.equal(
      plain
    );
    expect(await audioHash(write('ape-footer.mp3', audio, ape(9, false)))).to.equal(plain);
  });

  it('should change with the audio, and keep an empty audio range for a file of tags', async () => {
    expect(await audioHash(write('other.mp3', id3v2(10), Buffer.from('other audio')))).to.not.equal(
      sha(audio)
    );
    const tagsOnly = write('tags.mp3', id3v2(10));
    expect(await audioRange(tagsOnly)).to.deep.equal({ start: 20, end: 20 });
    expect(await audioHash(tagsOnly)).to.equal(sha(Buffer.alloc(0)));
    // a tag claiming more than the file holds
    expect(await audioRange(write('short.mp3', id3v2(10).subarray(0, 12)))).to.deep.equal({
      start: 12,
      end: 12
    });
  });

  it('should stay the same when node-id3 rewrites the tags of a real file', async () => {
    const file = path.join(dir, 'song.mp3');
    fs.copyFileSync(path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'), file);
    const before = await audioHash(file);
    NodeId3.update(
      {
        popularimeter: { email: 'x', rating: 255, counter: 0 },
        userDefinedText: [{ description: 'mood', value: 'Calm, Dreamy' }]
      },
      file
    );
    expect(fs.statSync(file).size).to.not.equal(0);
    expect(await audioHash(file)).to.equal(before);
    NodeId3.removeTags(file);
    expect(await audioHash(file)).to.equal(before);
  });
});
