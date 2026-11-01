const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const NodeId3 = require('node-id3');

const { readTagBuffer, walkFrames } = require('./frames.js');

/**
 * Checks that read the files: each file's tag (the ID3v2 header and frames, not the audio) is read once
 * and every file check looks at it. Findings are { file, detail } with paths relative to
 * mpd.baseDirectory, like the database's.
 */

// the custom frame descriptions of the multi value fields (TXXX.Context -> Context), by description
const multiDescriptions = config =>
  _.fromPairs(
    _.compact(
      _.map(_.filter(_.get(config, 'library.tags'), 'multi'), ({ name, id }) =>
        /^TXXX\./.test(id) ? [id.slice(5), name] : null
      )
    )
  );

/**
 * What is wrong with the way a multi value field is written: empty items (a trailing or doubled comma),
 * items with spaces around them, and items repeated (in any case). Empty when it is written cleanly.
 */
const multiProblems = value => {
  const items = `${value}`.split(',');
  const problems = [];
  if (_.some(items, item => item.trim() === '')) {
    problems.push('empty item');
  }
  if (_.some(items, item => item.trim() !== '' && item !== item.trim())) {
    problems.push('spaces around an item');
  }
  const named = _.compact(_.map(items, item => _.toLower(item.trim())));
  if (_.uniq(named).length < named.length) {
    problems.push('repeated item');
  }
  return problems;
};

/**
 * Reads the tag of one file and returns its findings per check: unreadable (no tag, a tag that cannot
 * be walked or parsed, a file that cannot be written), frames (frames node-id3 does not understand that
 * a rewrite would lose: musicman copies them back only into a plain ID3v2.3 tag), and multi (how the
 * multi value fields are written).
 */
const inspectFile = (file, { multi, access = fs.accessSync, readTag = readTagBuffer }) => {
  const found = { unreadable: [], frames: [], multi: [] };
  try {
    access(file, fs.constants.W_OK);
  } catch {
    found.unreadable.push('not writable');
  }
  let tag;
  try {
    tag = readTag(file);
  } catch (err) {
    found.unreadable.push(`cannot be read: ${err.message}`);
    return found;
  }
  if (!tag) {
    found.unreadable.push('no ID3v2 tag');
    return found;
  }
  const frames = walkFrames(tag);
  if (!frames) {
    found.unreadable.push(
      `ID3v2.${tag[3]} tag cannot be walked (unsynchronised, ID3v2.2, or damaged), a rewrite would lose frames`
    );
    return found;
  }
  let parsed;
  try {
    parsed = NodeId3.read(tag);
  } catch (err) {
    found.unreadable.push(`node-id3 cannot parse the tag: ${err.message}`);
    return found;
  }
  const known = new Set(_.keys(parsed.raw || {}));
  const unknown = _.uniq(
    _.map(
      _.reject(frames, ({ id }) => known.has(id)),
      'id'
    )
  );
  if (unknown.length && (tag[3] !== 3 || tag[5] & 0x40)) {
    found.frames.push(
      `${unknown.join(', ')} in an ID3v2.${tag[3]}${tag[5] & 0x40 ? ' (extended header)' : ''} tag would be lost on a rewrite`
    );
  }
  _.each([].concat(parsed.userDefinedText || []), ({ description, value }) => {
    const field = multi[description];
    const problems = field ? multiProblems(value || '') : [];
    if (problems.length) {
      found.multi.push(`${field} '${value}': ${problems.join(', ')}`);
    }
  });
  return found;
};

/**
 * Differences between the database and the files: files changed since the last db --update (mtime or
 * size), songs whose file is gone, and files the database does not have. songs are the database rows
 * checked, files the mp3 files on disk under the target (absolute paths).
 */
const driftFindings = ({ songs, files, baseDirectory, stat = fs.statSync }) => {
  const relative = file => path.relative(baseDirectory, file);
  const onDisk = new Set(_.map(files, relative));
  const known = new Set(_.map(songs, 'path'));
  const findings = [];
  _.each(songs, song => {
    if (!onDisk.has(song.path)) {
      findings.push({ file: song.path, detail: 'in the database, but the file is gone' });
      return;
    }
    const { mtimeMs, size } = stat(path.join(baseDirectory, song.path));
    if (Math.floor(mtimeMs) !== song.mtime || size !== song.size) {
      findings.push({ file: song.path, detail: 'changed since the last db --update' });
    }
  });
  _.each(
    _.reject([...onDisk], file => known.has(file)),
    file => findings.push({ file, detail: 'not in the database' })
  );
  return _.sortBy(findings, 'file');
};

/**
 * Runs the file checks named in wanted (drift, unreadable, frames, multi) over files, resolving to
 * findings per check. onProgress(done, total) is called as files are read.
 */
const fileChecks = async ({
  songs,
  files,
  baseDirectory,
  config,
  wanted,
  onProgress = () => {}
}) => {
  const results = {};
  if (wanted.includes('drift')) {
    results.drift = driftFindings({ songs, files, baseDirectory });
  }
  const perFile = _.intersection(wanted, ['unreadable', 'frames', 'multi']);
  if (perFile.length === 0) {
    return results;
  }
  _.each(perFile, name => {
    results[name] = [];
  });
  const multi = multiDescriptions(config);
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const found = inspectFile(file, { multi });
    _.each(perFile, name =>
      _.each(found[name], detail =>
        results[name].push({ file: path.relative(baseDirectory, file), detail })
      )
    );
    if (i % 200 === 199 || i === files.length - 1) {
      onProgress(i + 1, files.length);
      // lets the progress line draw between batches
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return results;
};

module.exports = { driftFindings, fileChecks, inspectFile, multiDescriptions, multiProblems };
