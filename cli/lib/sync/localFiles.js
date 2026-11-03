const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const { likedId } = require('./targets.js');

// songs Spotify has no track for: never found (missing) or every candidate rejected in review; songs in
// review or never looked up may still get a Spotify id
const exportStatuses = ['missing', 'rejected'];

const exportable = song => exportStatuses.includes(song.match);

const plainText = text => `${text || ''}`.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Whether a local track in a playlist is a song ({ artist, title, duration } from its tags): Spotify
 * names a local track by the file's ID3 tags and gives its length in whole seconds, so artist and title
 * agree and the lengths are within 2 seconds.
 */
const isLocalTrackOf = (tags, track) =>
  plainText(tags.artist) === plainText(track.artists) &&
  plainText(tags.title) === plainText(track.name) &&
  (!tags.duration || !track.duration_ms || Math.abs(tags.duration - track.duration_ms / 1000) <= 2);

/**
 * The songs of a playlist that only a local file can bring there (songs: [{ file, tags }]) against its
 * local tracks (remote rows with is_local): { added, pending, stray }, stray being local tracks that are
 * none of the songs (a song whose tags changed since, or one that is not exported).
 */
const localTracks = (songs, remote) => {
  const local = _.filter(remote, 'is_local');
  const used = new Set();
  const [added, pending] = _.partition(songs, song => {
    const index = _.findIndex(
      local,
      (track, i) => !used.has(i) && isLocalTrackOf(song.tags || {}, track)
    );
    if (index < 0) {
      return false;
    }
    used.add(index);
    return true;
  });
  return { added, pending, stray: _.filter(local, (track, i) => !used.has(i)) };
};

// characters a phone's shared storage or Windows refuse in file names
const safeName = text =>
  `${text || ''}`
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');

// "Artist - Title.mp3" from the song's tags, its own file name when it has neither
const exportName = song => {
  const extension = path.extname(song.file).toLowerCase() || '.mp3';
  const name = safeName(_.compact([song.tags.artist, song.tags.title]).join(' - '));
  return `${name || safeName(path.basename(song.file, path.extname(song.file)))}${extension}`;
};

/**
 * File names in the export for the songs (paths relative to the library), keeping the names given
 * before (previous: { path: name }) so a song keeps its file; new names that are taken (in any case,
 * phones' shared storage ignores it) get " (2)", " (3)", ...
 */
const assignNames = (songs, previous = {}) => {
  const names = {};
  const taken = new Set();
  const kept = _.filter(songs, song => previous[song.path]);
  _.each(kept, song => {
    names[song.path] = previous[song.path];
    taken.add(previous[song.path].toLowerCase());
  });
  _.each(_.reject(songs, song => previous[song.path]), song => {
    const name = exportName(song);
    const extension = path.extname(name);
    const stem = name.slice(0, name.length - extension.length);
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
      candidate = `${stem} (${n})${extension}`;
    }
    names[song.path] = candidate;
    taken.add(candidate.toLowerCase());
  });
  return names;
};

/**
 * What the export holds for a sync plan: every exportable song once in files/ (for the phone) and the
 * pending songs of one playlist in stage/ (the desktop app's Local Files source to drag from). Playlists
 * are staged in plan order, Liked Songs last. previous is the last export's state ({ names }).
 * Returns { songs: [{ file, path, name }], targets: [{ id, name, total, added, pending, stray }], staged }.
 */
const planExport = (plan, { baseDirectory, previous = {} }) => {
  const byFile = _.uniqBy(
    _.flatMap(plan, target => _.filter(target.noId, exportable)),
    'file'
  );
  const songs = _.map(byFile, song => ({
    file: song.file,
    path: path.relative(baseDirectory, song.file),
    tags: song.tags || {}
  }));
  const names = assignNames(songs, previous.names);
  const nameOf = file => names[path.relative(baseDirectory, file)];
  const targets = _.map(
    _.sortBy(plan, target => (target.id === likedId ? 1 : 0)),
    target => {
      const local = target.localFiles || { added: [], pending: [], stray: [] };
      return {
        id: target.id,
        name: target.name,
        total: local.added.length + local.pending.length,
        added: _.map(local.added, ({ file }) => nameOf(file)),
        pending: _.map(local.pending, ({ file }) => nameOf(file)),
        stray: _.map(local.stray, track => `${track.artists || '?'} - ${track.name || '?'}`)
      };
    }
  );
  return {
    songs: _.map(songs, song => ({ file: song.file, path: song.path, name: names[song.path] })),
    targets,
    staged: _.find(targets, target => target.pending.length > 0) || null
  };
};

// a hard link to the library file, a copy where links are refused (another filesystem)
const linkOrCopy = (source, target) => {
  try {
    fs.linkSync(source, target);
    return 'linked';
  } catch (err) {
    if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'].includes(err.code)) {
      throw err;
    }
    fs.copyFileSync(source, target);
    return 'copied';
  }
};

// whether target is still the library file: the same inode, or for a copy the same size and no older
const sameFile = (source, target) => {
  const a = fs.statSync(source);
  const b = fs.statSync(target);
  return a.ino === b.ino || (a.size === b.size && b.mtimeMs >= a.mtimeMs);
};

const stateFile = uploadDirectory => path.join(uploadDirectory, 'export.json');

const writeExportState = (uploadDirectory, state) =>
  fs.writeFileSync(stateFile(uploadDirectory), `${JSON.stringify(state, null, 2)}\n`);

const readExportState = uploadDirectory => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(uploadDirectory), 'utf8'));
  } catch {
    return {};
  }
};

const checklist = (exported, { date }) => {
  const staged = exported.staged;
  const lines = [
    '# Songs for Spotify Local Files',
    '',
    `Written by \`musicman sync --export\` on ${date}. Spotify has no track for these songs, so only a`,
    'local file can bring them to their playlists.',
    '',
    `- \`files/\` holds all ${exported.songs.length} songs, where Spotify plays them from: a Local Files source`,
    '  of the desktop app, and synced to the phone (with "Show audio files from this device" on).',
    staged
      ? `- \`stage/\` holds the ${staged.pending.length} songs to add to **${staged.name}**: in the desktop ` +
        'app, turn the `files` source off (Local Files then lists only `stage/`), select all in Local Files, ' +
        'drag them into the playlist, turn `files` back on, and run `musicman sync --export` again.'
      : '- Every song is in its playlists, `stage/` is empty.',
    ''
  ];
  _.each(
    _.filter(exported.targets, target => target.total > 0 || target.stray.length > 0),
    target => {
      lines.push(`## ${target.name} (${target.added.length} of ${target.total} added)`, '');
      _.each(_.sortBy(target.pending), name => lines.push(`- [ ] ${name}`));
      _.each(_.sortBy(target.added), name => lines.push(`- [x] ${name}`));
      if (target.stray.length > 0) {
        lines.push('', 'Local tracks in the playlist that are none of these songs (tags changed since?):');
        _.each(target.stray, name => lines.push(`- ${name}`));
      }
      lines.push('');
    }
  );
  return lines.join('\n');
};

/**
 * Brings the upload directory in line with an export plan: links new songs into files/ and links again
 * those whose library file was replaced, removes files of songs no longer exported (only names the last
 * export wrote, nothing else in the directory), fills stage/ with the staged playlist's pending songs,
 * and writes README.md and export.json. Returns { linked, copied, relinked, removed, staged }.
 */
const applyExport = (exported, { uploadDirectory, previous = {}, now = new Date() }) => {
  const filesDir = path.join(uploadDirectory, 'files');
  const stageDir = path.join(uploadDirectory, 'stage');
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });
  const counts = { linked: 0, copied: 0, relinked: 0, removed: 0, staged: 0 };
  const wanted = new Set(_.map(exported.songs, 'name'));
  _.each(_.values(previous.names || {}), name => {
    const file = path.join(filesDir, name);
    if (!wanted.has(name) && fs.existsSync(file)) {
      fs.unlinkSync(file);
      counts.removed += 1;
    }
  });
  _.each(exported.songs, song => {
    const target = path.join(filesDir, song.name);
    if (fs.existsSync(target)) {
      if (sameFile(song.file, target)) {
        return;
      }
      fs.unlinkSync(target);
      linkOrCopy(song.file, target);
      counts.relinked += 1;
      return;
    }
    counts[linkOrCopy(song.file, target)] += 1;
  });
  _.each(previous.stage || [], name => {
    const file = path.join(stageDir, name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  });
  const staged = exported.staged ? exported.staged.pending : [];
  const sourceOf = _.fromPairs(_.map(exported.songs, song => [song.name, song.file]));
  _.each(staged, name => {
    linkOrCopy(sourceOf[name], path.join(stageDir, name));
    counts.staged += 1;
  });
  fs.writeFileSync(
    path.join(uploadDirectory, 'README.md'),
    `${checklist(exported, { date: now.toISOString().slice(0, 10) })}\n`
  );
  fs.writeFileSync(
    stateFile(uploadDirectory),
    `${JSON.stringify(
      {
        // what other steps keep there (the phone mirror's state) stays
        ...previous,
        names: _.fromPairs(_.map(exported.songs, song => [song.path, song.name])),
        stage: staged,
        staged: exported.staged ? exported.staged.id : null
      },
      null,
      2
    )}\n`
  );
  return counts;
};

module.exports = {
  applyExport,
  assignNames,
  checklist,
  exportName,
  exportable,
  isLocalTrackOf,
  localTracks,
  planExport,
  readExportState,
  writeExportState
};
