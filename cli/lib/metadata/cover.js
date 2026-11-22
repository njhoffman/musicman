const _ = require('lodash');
const crypto = require('crypto');
const fs = require('fs');
const NodeId3 = require('node-id3');

/**
 * Embedded covers (APIC front cover frames) of songs: the default image singles carry until they are
 * identified on Spotify (library.defaultCover), and the Spotify album cover they get once they are.
 * A cover musicman embedded from Spotify is marked by its description, so taking a match back can put
 * the default image back without touching artwork the file came with.
 */

// the description of a cover embedded from Spotify
const spotifyCoverDescription = 'Spotify album cover';

const sha1 = buffer => crypto.createHash('sha1').update(buffer).digest('hex');

const mimeOf = file => (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg');

// the default image, read again only when the file changes
let cached = null;

/**
 * The default cover of library.defaultCover: { file, mime, buffer, hash }, or null when it is not set
 * or the file is missing.
 */
const defaultCover = config => {
  const file = _.get(config, 'library.defaultCover');
  if (!file) {
    return null;
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!cached || cached.file !== file || cached.mtimeMs !== stat.mtimeMs) {
    const buffer = fs.readFileSync(file);
    cached = { file, mtimeMs: stat.mtimeMs, mime: mimeOf(file), buffer, hash: sha1(buffer) };
  }
  return _.omit(cached, 'mtimeMs');
};

// an APIC front cover frame, as node-id3 reads and writes it
const coverFrame = ({ mime, buffer, description = '' }) => ({
  mime,
  type: { id: 3, name: 'front cover' },
  description,
  imageBuffer: buffer
});

// the default cover as an APIC frame, null without one
const defaultCoverFrame = config => {
  const cover = defaultCover(config);
  return cover ? coverFrame(cover) : null;
};

// the embedded cover of a file (node-id3's image), null when it has none or cannot be read
const embeddedCover = (file, { readTags = NodeId3.read } = {}) => {
  try {
    const image = _.get(readTags(file, { include: ['APIC'] }), 'image');
    return image && image.imageBuffer && image.imageBuffer.length ? image : null;
  } catch {
    return null;
  }
};

/**
 * What a cover (node-id3's image, or null) is: none, default (the image of library.defaultCover),
 * spotify (embedded from Spotify by musicman), or own (artwork the file came with).
 */
const coverState = (image, config) => {
  if (!image) {
    return 'none';
  }
  const cover = defaultCover(config);
  if (cover && sha1(image.imageBuffer) === cover.hash) {
    return 'default';
  }
  return image.description === spotifyCoverDescription ? 'spotify' : 'own';
};

// whether a cover is only a placeholder that the Spotify album cover replaces
const replaceable = state => state === 'none' || state === 'default';

/**
 * Downloads an image URL as an APIC front cover frame marked as embedded from Spotify. Throws on an
 * HTTP error.
 */
const downloadCover = async (url, fetchImpl = fetch) => {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`cover ${url}: HTTP ${response.status}`);
  }
  return coverFrame({
    mime: `${response.headers.get('content-type') || 'image/jpeg'}`.split(';')[0],
    buffer: Buffer.from(await response.arrayBuffer()),
    description: spotifyCoverDescription
  });
};

// downloads each URL once, failures resolve to null so a missing cover never stops a run
const coverDownloader = (fetchImpl = fetch) => {
  const images = new Map();
  return url => {
    if (!images.has(url)) {
      images.set(
        url,
        downloadCover(url, fetchImpl).catch(() => null)
      );
    }
    return images.get(url);
  };
};

module.exports = {
  coverDownloader,
  coverFrame,
  coverState,
  defaultCover,
  defaultCoverFrame,
  downloadCover,
  embeddedCover,
  replaceable,
  spotifyCoverDescription
};
