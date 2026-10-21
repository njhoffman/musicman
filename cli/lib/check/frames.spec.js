const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { appendFrames, listFrameIds, readTagBuffer } = require('./frames.js');

describe('ID3 Frames', () => {
  let directory;
  let file;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-frames-'));
    file = path.join(directory, 'song.mp3');
    fs.copyFileSync(path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'), file);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should read only the tag and list its frames in order with repeats', () => {
    const tag = readTagBuffer(file);
    expect(tag.toString('latin1', 0, 3)).to.equal('ID3');
    expect(tag.length).to.be.below(fs.statSync(file).size);
    const ids = listFrameIds(tag);
    expect(ids).to.include.members(Object.keys(NodeId3.read(file).raw));
    expect(ids.filter(id => id === 'TXXX').length).to.equal(
      [].concat(NodeId3.read(file).raw.TXXX).length
    );
  });

  it('should have no tag for a file without one', () => {
    const plain = path.join(directory, 'plain.mp3');
    fs.writeFileSync(plain, Buffer.from('not an mp3 with tags'));
    expect(readTagBuffer(plain)).to.be.null;
    expect(listFrameIds(null)).to.be.null;
  });

  it('should append raw frames and keep the audio', () => {
    const audio = fs.readFileSync(file).subarray(readTagBuffer(file).length);
    const frame = Buffer.concat([
      Buffer.from('TCMP'),
      Buffer.from([0, 0, 0, 2, 0, 0, 0]),
      Buffer.from('1')
    ]);
    expect(appendFrames(file, [frame])).to.be.true;
    const tag = readTagBuffer(file);
    expect(listFrameIds(tag).slice(-1)).to.deep.equal(['TCMP']);
    expect(fs.readFileSync(file).subarray(tag.length).equals(audio)).to.be.true;
    expect(NodeId3.read(file).raw.TIT2).to.equal(NodeId3.read(file).raw.TIT2);
  });
});
