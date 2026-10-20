const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');
const { readHeaderDuration } = require('./duration.js');

// MPEG1 layer 3, 44.1kHz, stereo frame header for the given bitrate index (9 = 128kbps)
const frameHeader = (bitrateIndex = 9) =>
  Buffer.from([0xff, 0xfb, (bitrateIndex << 4) | 0x00, 0x00]);
const frameLength = kbps => Math.floor((144 * kbps * 1000) / 44100);

const frame = (contents = Buffer.alloc(0), kbps = 128) => {
  const body = Buffer.alloc(frameLength(kbps) - 4);
  contents.copy(body);
  return Buffer.concat([frameHeader(), body]);
};

// Xing header after 32 bytes of MPEG1 stereo side information, with the frame count flag set
const xingFrame = (frames, id = 'Xing') => {
  const xing = Buffer.alloc(44);
  xing.write(id, 32, 'latin1');
  xing.writeUInt32BE(0x01, 36);
  xing.writeUInt32BE(frames, 40);
  return frame(xing);
};

const vbriFrame = frames => {
  const vbri = Buffer.alloc(50);
  vbri.write('VBRI', 32, 'latin1');
  vbri.writeUInt32BE(frames, 46);
  return frame(vbri);
};

const id3v2Tag = size => {
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, (size >> 7) & 0x7f, size & 0x7f]);
  return Buffer.concat([header, Buffer.alloc(size)]);
};

describe('MP3 Header Duration', () => {
  let tmpDir;
  const writeMp3 = (...parts) => {
    const file = path.join(tmpDir, 'test.mp3');
    fs.writeFileSync(file, Buffer.concat(parts));
    return file;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-duration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should use the Xing frame count for VBR files', async () => {
    const file = writeMp3(xingFrame(1000), frame(), frame());
    expect(await readHeaderDuration(file)).to.be.closeTo((1000 * 1152) / 44100, 0.0001);
  });

  it('should use the Info frame count written by LAME for CBR files', async () => {
    const file = writeMp3(xingFrame(500, 'Info'), frame(), frame());
    expect(await readHeaderDuration(file)).to.be.closeTo((500 * 1152) / 44100, 0.0001);
  });

  it('should use the VBRI frame count', async () => {
    const file = writeMp3(vbriFrame(2000), frame(), frame());
    expect(await readHeaderDuration(file)).to.be.closeTo((2000 * 1152) / 44100, 0.0001);
  });

  it('should compute constant bitrate duration from audio size', async () => {
    const frames = Array.from({ length: 100 }, () => frame());
    const file = writeMp3(...frames);
    const audioBytes = 100 * frameLength(128);
    expect(await readHeaderDuration(file)).to.be.closeTo((audioBytes * 8) / 128000, 0.0001);
  });

  it('should skip the ID3v2 tag and exclude an ID3v1 tag from the audio size', async () => {
    const frames = Array.from({ length: 10 }, () => frame());
    const id3v1 = Buffer.concat([Buffer.from('TAG', 'latin1'), Buffer.alloc(125)]);
    const file = writeMp3(id3v2Tag(2000), ...frames, id3v1);
    expect(await readHeaderDuration(file)).to.be.closeTo(
      (10 * frameLength(128) * 8) / 128000,
      0.0001
    );
  });

  it('should ignore a false sync before the first real frame', async () => {
    const file = writeMp3(
      Buffer.from([0x00, 0xff, 0xfb, 0x90, 0x00, 0x12]),
      xingFrame(10),
      frame()
    );
    expect(await readHeaderDuration(file)).to.be.closeTo((10 * 1152) / 44100, 0.0001);
  });

  it('should return null when there is no MPEG audio frame', async () => {
    const file = writeMp3(id3v2Tag(100), Buffer.from('not audio data'));
    expect(await readHeaderDuration(file)).to.be.null;
  });

  it('should match decoded duration for test files', async () => {
    const mp3Duration = require('mp3-duration');
    const file = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile01.mp3');
    const decoded = await new Promise((resolve, reject) =>
      mp3Duration(file, (err, duration) => (err ? reject(err) : resolve(duration)))
    );
    expect(await readHeaderDuration(file)).to.be.closeTo(decoded, 0.1);
  });
});
