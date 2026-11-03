const fs = require('fs');

const { readTagBuffer, syncsafe } = require('../metadata/tagBuffer.js');

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
 * the tag size and keeping the audio. Frames of the ids in last already in the tag are moved after the
 * appended ones, so a reader taking the last frame of an id (node-id3) still reads the same one.
 * Returns false when the file's tag is not one that can be extended.
 */
const appendFrames = (file, frames, { last = [] } = {}) => {
  const tag = readTagBuffer(file);
  const existing = walkFrames(tag);
  if (!existing || tag[3] !== 3 || tag[5] & 0x40) {
    return false;
  }
  const moved = new Set(last);
  const bytes = ({ start, end }) => tag.subarray(start, end);
  const body = Buffer.concat([
    ...existing.filter(({ id }) => !moved.has(id)).map(bytes),
    ...frames,
    ...existing.filter(({ id }) => moved.has(id)).map(bytes)
  ]);
  const header = Buffer.concat([tag.subarray(0, 6), encodeSyncsafe(body.length)]);
  const audio = fs.readFileSync(file).subarray(tag.length);
  fs.writeFileSync(file, Buffer.concat([header, body, audio]));
  return true;
};

// frames node-id3 0.2.9 reads and writes once even when a tag holds several (a comment next to
// iTunNORM, a front and a back cover): a rewrite keeps one and drops the others
const singleFrames = new Set(['APIC', 'COMM', 'ETCO', 'POPM', 'USLT']);

module.exports = { appendFrames, listFrameIds, readTagBuffer, singleFrames, walkFrames };
