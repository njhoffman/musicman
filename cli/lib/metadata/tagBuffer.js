const fs = require('fs');

// 28 bit integer stored in 4 bytes of 7 bits, used for ID3v2 tag sizes and v2.4 frame sizes
const syncsafe = (buffer, offset) =>
  ((buffer[offset] & 0x7f) << 21) |
  ((buffer[offset + 1] & 0x7f) << 14) |
  ((buffer[offset + 2] & 0x7f) << 7) |
  (buffer[offset + 3] & 0x7f);

// the size of the whole tag (header and footer included) from its 10 byte header, null when it is none
const tagSize = header =>
  header.length >= 10 && header.toString('latin1', 0, 3) === 'ID3'
    ? 10 + syncsafe(header, 6) + (header[5] & 0x10 ? 10 : 0)
    : null;

/**
 * The ID3v2 tag at the start of an mp3 file (header included), read without the audio; null when the
 * file has no ID3v2 tag there. node-id3 given the tag alone reads the same frames as given the path,
 * which reads the whole file (all 7363 library files compared on 2026-11-03).
 */
const readTagBuffer = file => {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(10);
    const size = fs.readSync(fd, header, 0, 10, 0) < 10 ? null : tagSize(header);
    if (size === null) {
      return null;
    }
    const tag = Buffer.alloc(size);
    fs.readSync(fd, tag, 0, size, 0);
    return tag;
  } finally {
    fs.closeSync(fd);
  }
};

// readTagBuffer without blocking, for reading many files at once
const readTagBufferAsync = async file => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await handle.read(header, 0, 10, 0);
    const size = bytesRead < 10 ? null : tagSize(header);
    if (size === null) {
      return null;
    }
    const tag = Buffer.alloc(size);
    await handle.read(tag, 0, size, 0);
    return tag;
  } finally {
    await handle.close();
  }
};

module.exports = { readTagBuffer, readTagBufferAsync, syncsafe };
