const fs = require('fs');

// kbps indexed by [version][layer][bitrate index], version 1 is MPEG1, 2 is MPEG2 and MPEG2.5
const bitrates = {
  1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  },
  2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  }
};

// Hz indexed by version bits (0 MPEG2.5, 2 MPEG2, 3 MPEG1) and sample rate index
const sampleRates = { 0: [11025, 12000, 8000], 2: [22050, 24000, 16000], 3: [44100, 48000, 32000] };

// bytes scanned after the ID3v2 tag for the first audio frame
const scanLength = 256 * 1024;

const parseFrameHeader = (buffer, offset) => {
  if (
    offset + 4 > buffer.length ||
    buffer[offset] !== 0xff ||
    (buffer[offset + 1] & 0xe0) !== 0xe0
  ) {
    return null;
  }
  const versionBits = (buffer[offset + 1] >> 3) & 0x03;
  const layerBits = (buffer[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
  if (
    versionBits === 1 ||
    layerBits === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return null;
  }

  const version = versionBits === 3 ? 1 : 2;
  const layer = 4 - layerBits;
  const bitrate = bitrates[version][layer][bitrateIndex] * 1000;
  const sampleRate = sampleRates[versionBits][sampleRateIndex];
  const padding = (buffer[offset + 2] >> 1) & 0x01;
  const mono = ((buffer[offset + 3] >> 6) & 0x03) === 3;

  let samplesPerFrame = 1152;
  if (layer === 1) {
    samplesPerFrame = 384;
  } else if (layer === 3 && version === 2) {
    samplesPerFrame = 576;
  }
  const frameLength =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;

  // layer 3 side information precedes the Xing/Info header
  let sideInfoLength = 0;
  if (layer === 3) {
    sideInfoLength = version === 1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  }

  return { bitrate, sampleRate, samplesPerFrame, frameLength, sideInfoLength };
};

// first frame header that is followed by another valid frame header, to skip false sync bytes
const findFirstFrame = buffer => {
  for (let offset = 0; offset < buffer.length - 4; offset += 1) {
    const frame = parseFrameHeader(buffer, offset);
    if (frame) {
      const next = offset + frame.frameLength;
      if (next + 4 > buffer.length || parseFrameHeader(buffer, next)) {
        return { offset, frame };
      }
    }
  }
  return null;
};

// total frame count from a Xing/Info (LAME) or VBRI header in the first frame
const readFrameCount = (buffer, offset, frame) => {
  const xingOffset = offset + 4 + frame.sideInfoLength;
  const xingId = buffer.toString('latin1', xingOffset, xingOffset + 4);
  if ((xingId === 'Xing' || xingId === 'Info') && xingOffset + 12 <= buffer.length) {
    const flags = buffer.readUInt32BE(xingOffset + 4);
    return flags & 0x01 ? buffer.readUInt32BE(xingOffset + 8) : null;
  }
  const vbriOffset = offset + 4 + 32;
  if (
    buffer.toString('latin1', vbriOffset, vbriOffset + 4) === 'VBRI' &&
    vbriOffset + 18 <= buffer.length
  ) {
    return buffer.readUInt32BE(vbriOffset + 14);
  }
  return null;
};

const readBytes = async (handle, length, position) => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
};

// ID3v2 tag length including header and optional footer, 0 when there is no tag
const id3v2Length = header => {
  if (header.length < 10 || header.toString('latin1', 0, 3) !== 'ID3') {
    return 0;
  }
  // tag size is a 28 bit syncsafe integer
  const size =
    ((header[6] & 0x7f) << 21) |
    ((header[7] & 0x7f) << 14) |
    ((header[8] & 0x7f) << 7) |
    (header[9] & 0x7f);
  const footer = header[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
};

/**
 * Reads mp3 duration in seconds from frame headers without decoding the audio.
 * Uses the Xing/Info or VBRI frame count when present, otherwise assumes constant bitrate.
 * Returns null when no MPEG audio frame is found.
 */
const readHeaderDuration = async file => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const audioStart = id3v2Length(await readBytes(handle, 10, 0));
    const buffer = await readBytes(handle, scanLength, audioStart);

    const first = findFirstFrame(buffer);
    if (!first) {
      return null;
    }
    const { offset, frame } = first;

    const frameCount = readFrameCount(buffer, offset, frame);
    if (frameCount) {
      return (frameCount * frame.samplesPerFrame) / frame.sampleRate;
    }

    const id3v1 =
      fileSize >= 128 && (await readBytes(handle, 3, fileSize - 128)).toString('latin1') === 'TAG';
    const audioBytes = fileSize - audioStart - offset - (id3v1 ? 128 : 0);
    return (audioBytes * 8) / frame.bitrate;
  } finally {
    await handle.close();
  }
};

module.exports = { readHeaderDuration };
