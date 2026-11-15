const crypto = require('crypto');
const fs = require('fs');

const { syncsafe } = require('./tagBuffer.js');

/**
 * The audio of an mp3 file: the byte range without its tags, so tag writes (ratings, moods) and moves
 * leave it the same. Skips ID3v2 tags at the start (each with its footer, one after another), and at the
 * end an ID3v1 tag (128 bytes, TAG) and an APEv2 tag (APETAGEX footer, with its header when flagged).
 * Resolves to { start, end } (end exclusive).
 */
const audioRange = async file => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const read = async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead);
    };
    let start = 0;
    for (;;) {
      const header = await read(start, 10);
      if (header.length < 10 || header.toString('latin1', 0, 3) !== 'ID3') {
        break;
      }
      start += 10 + syncsafe(header, 6) + (header[5] & 0x10 ? 10 : 0);
    }
    let end = size;
    if (end - start >= 128) {
      const v1 = await read(end - 128, 3);
      if (v1.toString('latin1') === 'TAG') {
        end -= 128;
      }
    }
    if (end - start >= 32) {
      const footer = await read(end - 32, 32);
      if (footer.toString('latin1', 0, 8) === 'APETAGEX') {
        // the tag size counts the items and the footer; bit 31 of the flags says a 32 byte header leads
        const tagSize = footer.readUInt32LE(12) + (footer.readUInt32LE(20) & 0x80000000 ? 32 : 0);
        if (tagSize <= end - start) {
          end -= tagSize;
        }
      }
    }
    return { start: Math.min(start, size), end: Math.max(Math.min(start, size), end) };
  } finally {
    await handle.close();
  }
};

/**
 * SHA-256 (hex) of a file's audio (audioRange): the same for the file before and after a tag write, a
 * move, or a copy on another computer, so it names the song across them (docs/10-host-sync.md).
 */
const audioHash = async file => {
  const { start, end } = await audioRange(file);
  const hash = crypto.createHash('sha256');
  if (end > start) {
    await new Promise((resolve, reject) => {
      fs.createReadStream(file, { start, end: end - 1 })
        .on('data', chunk => hash.update(chunk))
        .on('end', resolve)
        .on('error', reject);
    });
  }
  return hash.digest('hex');
};

module.exports = { audioHash, audioRange };
