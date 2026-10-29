const _ = require('lodash');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');

// covers shown by the menu default to $XDG_CACHE_HOME/musicman/covers
const coverDirectory = (env = process.env) =>
  path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'musicman', 'covers');

// image files next to a song that hold its album cover, best first
const folderCovers = ['cover', 'folder', 'front', 'album'];
const imageExtensions = ['.jpg', '.jpeg', '.png'];

const extensionOf = mime => (/png/i.test(mime || '') ? '.png' : '.jpg');

// the album cover in the song's folder, matched case-insensitively
const folderCover = file => {
  let names;
  try {
    names = fs.readdirSync(path.dirname(file));
  } catch {
    return null;
  }
  const images = _.filter(names, name =>
    imageExtensions.includes(path.extname(name).toLowerCase())
  );
  const best = _.minBy(
    _.filter(images, name =>
      folderCovers.includes(path.basename(name, path.extname(name)).toLowerCase())
    ),
    name => folderCovers.indexOf(path.basename(name, path.extname(name)).toLowerCase())
  );
  return best ? path.join(path.dirname(file), best) : null;
};

/**
 * The cover of a local song as an image file: its embedded picture (APIC), saved once per file and
 * modification time to directory, else an image in its folder (cover.jpg, folder.jpg, ...), else null.
 */
const localCover = (file, directory, { readTags = NodeId3.read } = {}) => {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const key = crypto.createHash('sha1').update(`${file}:${stat.mtimeMs}`).digest('hex');
  const cached = _.find(imageExtensions, ext =>
    fs.existsSync(path.join(directory, `${key}${ext}`))
  );
  if (cached) {
    return path.join(directory, `${key}${cached}`);
  }
  const image = _.get(readTags(file, { include: ['APIC'] }), 'image');
  if (image && image.imageBuffer && image.imageBuffer.length) {
    fs.mkdirSync(directory, { recursive: true });
    const saved = path.join(directory, `${key}${extensionOf(image.mime)}`);
    fs.writeFileSync(saved, image.imageBuffer);
    return saved;
  }
  return folderCover(file);
};

/**
 * The cover at a Spotify image URL (https://i.scdn.co/image/<id>), downloaded once to directory.
 * Resolves to null when it cannot be downloaded, a missing cover never stops the menu.
 */
const remoteCover = async (url, directory, { fetchImpl = fetch } = {}) => {
  const name = /\/image\/([A-Za-z0-9]+)$/.exec(url || '');
  if (!name) {
    return null;
  }
  const file = path.join(directory, `${name[1]}.jpg`);
  if (fs.existsSync(file)) {
    return file;
  }
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return null;
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
};

// the cover of a playing track: the local file's for MPD and linked Spotify tracks, Spotify's otherwise
const coverFor = async (
  track,
  { file, directory = coverDirectory(), fetchImpl, readTags } = {}
) => {
  if (!track) {
    return null;
  }
  const local = file || track.file;
  const fromFile = local ? localCover(local, directory, { readTags }) : null;
  return fromFile || (track.artUrl ? remoteCover(track.artUrl, directory, { fetchImpl }) : null);
};

module.exports = { coverDirectory, coverFor, folderCover, localCover, remoteCover };
