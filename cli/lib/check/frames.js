const fs = require('fs');

// 28 bit integer stored in 4 bytes of 7 bits, used for ID3v2 tag sizes and v2.4 frame sizes
const syncsafe = (buffer, offset) =>
  ((buffer[offset] & 0x7f) << 21) |
  ((buffer[offset + 1] & 0x7f) << 14) |
  ((buffer[offset + 2] & 0x7f) << 7) |
  (buffer[offset + 3] & 0x7f);

/**
 * The ID3v2 tag at the start of an mp3 file (header included), read without the audio; null when the
 * file has no ID3v2 tag.
 */
const readTagBuffer = file => {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(10);
    if (fs.readSync(fd, header, 0, 10, 0) < 10 || header.toString('latin1', 0, 3) !== 'ID3') {
      return null;
    }
    const size = 10 + syncsafe(header, 6) + (header[5] & 0x10 ? 10 : 0);
    const tag = Buffer.alloc(size);
    fs.readSync(fd, tag, 0, size, 0);
    return tag;
  } finally {
    fs.closeSync(fd);
  }
};

/**
 * Frames of an ID3v2.3 or v2.4 tag buffer as { id, start, end } byte ranges (header included), parsed from
 * the frame headers alone, so frames node-id3 does not understand are listed too. null for other tag
 * versions (v2.2 uses 3 character ids), unsynchronised tags, or a tag that cannot be walked.
 */
const walkFrames = tag => {
  if (!tag || tag.toString('latin1', 0, 3) !== 'ID3') {
    return null;
  }
  const version = tag[3];
  if ((version !== 3 && version !== 4) || tag[5] & 0x80) {
    return null;
  }
  const end = 10 + syncsafe(tag, 6);
  let offset = 10;
  // an extended header comes first when flagged, its size is syncsafe in v2.4 and excludes itself in v2.3
  if (tag[5] & 0x40) {
    offset += version === 4 ? syncsafe(tag, 10) : tag.readUInt32BE(10) + 4;
  }
  const frames = [];
  while (offset + 10 <= end && offset + 10 <= tag.length) {
    const id = tag.toString('latin1', offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      break;
    }
    const size = version === 4 ? syncsafe(tag, offset + 4) : tag.readUInt32BE(offset + 4);
    if (offset + 10 + size > tag.length) {
      return null;
    }
    frames.push({ id, start: offset, end: offset + 10 + size });
    offset += 10 + size;
  }
  return frames;
};

// frame ids in order and with repeats (e.g. several TXXX), null when the tag cannot be walked
const listFrameIds = tag => {
  const frames = walkFrames(tag);
  return frames ? frames.map(({ id }) => id) : null;
};

const encodeSyncsafe = size =>
  Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);

/**
 * Appends raw frames (complete ID3v2.3 frames, header included) to the ID3v2.3 tag of a file, rewriting
 * the tag size and keeping the audio. Returns false when the file's tag is not one that can be extended.
 */
const appendFrames = (file, frames) => {
  const tag = readTagBuffer(file);
  const existing = walkFrames(tag);
  if (!existing || tag[3] !== 3 || tag[5] & 0x40) {
    return false;
  }
  const framesEnd = existing.length > 0 ? existing[existing.length - 1].end : 10;
  const body = Buffer.concat([tag.subarray(10, framesEnd), ...frames]);
  const header = Buffer.concat([tag.subarray(0, 6), encodeSyncsafe(body.length)]);
  const audio = fs.readFileSync(file).subarray(tag.length);
  fs.writeFileSync(file, Buffer.concat([header, body, audio]));
  return true;
};

module.exports = { appendFrames, listFrameIds, readTagBuffer, walkFrames };
