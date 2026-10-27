const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const NodeId3 = require('node-id3');

const { listFrameIds, readTagBuffer } = require('../check/frames.js');

// files only in the backup are moved here instead of deleted, and this folder is never scanned
const removedFolder = '.musicman-removed';

const globTokens = { '/**': '(?:/.*)?', '**': '.*', '*': '[^/]*' };

// glob relative to the source: a trailing /** also matches the folder itself, ** any path, * any name part
const globPattern = pattern =>
  new RegExp(
    `^${pattern
      .split(/(\/\*\*$|\*\*|\*)/)
      .map(part => globTokens[part] || part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('')}$`
  );

// every file under a directory as relative path -> { size, mtimeMs }, leaving out excluded paths
const listTree = (root, excluded = () => false) => {
  const files = new Map();
  if (!fs.existsSync(root)) {
    return files;
  }
  const walk = relative => {
    fs.readdirSync(path.join(root, relative), { withFileTypes: true }).forEach(entry => {
      const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
      if (excluded(entryPath)) {
        return;
      }
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(root, entryPath));
        files.set(entryPath, { size: stat.size, mtimeMs: stat.mtimeMs });
      }
    });
  };
  walk('');
  return files;
};

// network file systems keep coarser times, so modification times within 2 seconds count as equal
const sameFile = (a, b) => a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 2000;

// a frame value without data, e.g. a lyrics frame with no text, which writers like node-id3 leave out
const isEmptyValue = value =>
  _.every([].concat(value), item =>
    _.isString(item)
      ? item.trim() === ''
      : _.isPlainObject(item) && `${item.text || ''}`.trim() === ''
  );

// frame ids with data that the backup copy of an mp3 has and the library copy does not
const framesOnlyInBackup = (source, target) => {
  const sourceIds = new Set(listFrameIds(readTagBuffer(source)) || []);
  const targetTag = readTagBuffer(target);
  const raw = _.get(NodeId3.read(targetTag || Buffer.alloc(0)), 'raw', {});
  return _.uniq(
    _.filter(
      listFrameIds(targetTag) || [],
      id => !sourceIds.has(id) && !(_.has(raw, id) && isEmptyValue(raw[id]))
    )
  );
};

/**
 * What it takes to make directory a copy of source:
 *   copy: files only in the source
 *   update: files in both that differ (size or modification time)
 *   held: mp3 updates held back because the backup copy has frames the library copy lacks
 *   remove: files only in the backup, which are moved to .musicman-removed, never deleted
 * Paths matching exclude (globs relative to source, e.g. musicman.sqlite*) are left out on both sides.
 * layoutHint is set when the backup looks like a copy of one source subfolder (e.g. of Rated).
 */
const backupPlan = ({ source, directory, exclude = [] }) => {
  const patterns = _.map(exclude, globPattern);
  const excluded = relative => _.some(patterns, pattern => pattern.test(relative));
  const sourceFiles = listTree(source, excluded);
  const backupFiles = listTree(
    directory,
    relative => relative === removedFolder || excluded(relative)
  );

  const copy = [];
  const update = [];
  const held = [];
  let unchanged = 0;
  sourceFiles.forEach((stat, relative) => {
    const existing = backupFiles.get(relative);
    if (!existing) {
      copy.push({ path: relative, size: stat.size });
    } else if (sameFile(stat, existing)) {
      unchanged += 1;
    } else {
      const frames = relative.toLowerCase().endsWith('.mp3')
        ? framesOnlyInBackup(path.join(source, relative), path.join(directory, relative))
        : [];
      (frames.length > 0 ? held : update).push({ path: relative, size: stat.size, frames });
    }
  });
  const remove = _.map(
    [...backupFiles.keys()].filter(relative => !sourceFiles.has(relative)),
    relative => ({ path: relative, size: backupFiles.get(relative).size })
  );

  // a backup made of one source folder (Rated) has that folder's subfolders at its top
  const topLevel = folder => _.uniq([...folder.keys()].map(relative => relative.split('/')[0]));
  const sourceTop = new Set(topLevel(sourceFiles));
  const backupTop = topLevel(backupFiles);
  const parent = _.find([...sourceTop], folder =>
    _.every(backupTop, name => fs.existsSync(path.join(source, folder, name)))
  );
  const layoutHint =
    backupTop.length > 0 && !_.some(backupTop, name => sourceTop.has(name)) && parent
      ? { folder: parent, names: backupTop }
      : null;

  return { source, directory, copy, update, held, remove, unchanged, layoutHint };
};

const dateStamp = now => now.toISOString().slice(0, 10).replace(/-/g, '');

// copies through a temporary file in the same folder, so an interrupted copy never leaves a partial file;
// the time is set after the rename: a CIFS mount closes a written file late (closetimeo) and the server
// then stamps it with the current time, replacing a time set before the rename forced that close
const copyFile = (from, to, mtimeMs) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const temporary = `${to}.musicman-partial`;
  fs.copyFileSync(from, temporary);
  fs.renameSync(temporary, to);
  const time = new Date(mtimeMs);
  fs.utimesSync(to, time, time);
};

/**
 * Applies a backup plan: copies new and changed files (not held ones) and moves files only in the backup
 * to .musicman-removed/<date>/. onFile(action, entry) is called after each file. timesLost lists the
 * copies whose modification time did not stay the source's, which the next backup would copy again.
 */
const applyBackup = (plan, { now = new Date(), onFile = _.noop } = {}) => {
  const { source, directory } = plan;
  const result = { copied: 0, updated: 0, moved: 0, bytes: 0, removedTo: null, timesLost: [] };
  const copied = [...plan.copy, ...plan.update];
  [
    ...plan.copy.map(entry => ['copy', entry]),
    ...plan.update.map(entry => ['update', entry])
  ].forEach(([action, entry]) => {
    const from = path.join(source, entry.path);
    copyFile(from, path.join(directory, entry.path), fs.statSync(from).mtimeMs);
    result[action === 'copy' ? 'copied' : 'updated'] += 1;
    result.bytes += entry.size;
    onFile(action, entry);
  });
  // checked once every copy is done, so a time a file system replaces when it closes the file shows
  result.timesLost = _.map(
    _.filter(
      copied,
      entry =>
        !sameFile(
          fs.statSync(path.join(source, entry.path)),
          fs.statSync(path.join(directory, entry.path))
        )
    ),
    'path'
  );
  if (plan.remove.length > 0) {
    result.removedTo = path.join(directory, removedFolder, dateStamp(now));
    plan.remove.forEach(entry => {
      const to = path.join(result.removedTo, entry.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.join(directory, entry.path), to);
      result.moved += 1;
      onFile('move', entry);
    });
  }
  return result;
};

module.exports = { applyBackup, backupPlan, globPattern, removedFolder };
