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
 * local tracks (remote rows with is_local): { added, pending, stray, confirmed }, stray being local tracks
 * that are none of the songs (a song whose tags changed since, or one that is not exported). The Web API
 * never lists local files in Liked Songs, so songs whose file is in confirmed (sync --export --confirm)
 * count as added; confirmed is how many did.
 */
const localTracks = (songs, remote, confirmed = new Set()) => {
  const local = _.filter(remote, 'is_local');
  const used = new Set();
  let byConfirm = 0;
  const [added, pending] = _.partition(songs, song => {
    if (confirmed.size > 0 && confirmed.has(path.resolve(song.file))) {
      byConfirm += 1;
      return true;
    }
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
  return {
    added,
    pending,
    stray: _.filter(local, (track, i) => !used.has(i)),
    confirmed: byConfirm
  };
};

/**
 * The library files confirmed as added to a target (sync --export --confirm), from the export state in
 * sync.uploadDirectory: a function of the target id to a Set of absolute paths.
 */
const confirmedFiles = config => {
  const directory = _.get(config, 'sync.uploadDirectory');
  const confirmed = directory ? readExportState(directory).confirmed || {} : {};
  const base = path.resolve(_.get(config, 'mpd.baseDirectory', '.'));
  return id => new Set(_.map(confirmed[id] || [], relative => path.join(base, relative)));
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
 * are staged in plan order, Liked Songs last. previous is the last export's state ({ names }). Songs
 * confirmed as added to Liked Songs (confirmStaged) are added in the plan already (localTracks).
 * Returns { songs: [{ file, path, name }], targets: [{ id, name, total, added, pending, stray, confirmed }],
 * staged }.
 */
const planExport = (plan, { baseDirectory, previous = {}, readable = () => true }) => {
  const [byFile, unreadable] = _.partition(
    _.uniqBy(
      _.flatMap(plan, target => _.filter(target.noId, exportable)),
      'file'
    ),
    song => readable(song.file)
  );
  const skipped = new Set(_.map(unreadable, 'file'));
  const kept = list => _.reject(list, ({ file }) => skipped.has(file));
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
      const local = target.localFiles || { added: [], pending: [], stray: [], confirmed: 0 };
      const added = kept(local.added);
      const pending = kept(local.pending);
      return {
        id: target.id,
        name: target.name,
        total: added.length + pending.length,
        added: _.map(added, ({ file }) => nameOf(file)),
        pending: _.map(pending, ({ file }) => nameOf(file)),
        stray: _.map(local.stray, track => `${track.artists || '?'} - ${track.name || '?'}`),
        confirmed: local.confirmed || 0
      };
    }
  );
  return {
    songs: _.map(songs, song => ({ file: song.file, path: song.path, name: names[song.path] })),
    targets,
    staged: _.find(targets, target => target.pending.length > 0) || null,
    unreadable: _.map(unreadable, song => path.relative(baseDirectory, song.file))
  };
};

/**
 * The export state with the songs the last export staged recorded as added to Liked Songs (sync --export
 * --confirm), for after dragging them in: the Web API never lists local files in Liked Songs, so the
 * export cannot see them there. Only Liked Songs is confirmed this way; a staged playlist is checked
 * through the Web API. Returns { state, count }.
 */
const confirmStaged = (previous = {}) => {
  if (previous.staged !== likedId) {
    throw new Error(
      previous.staged
        ? 'only Liked Songs is confirmed with --confirm: the staged playlist is checked through the Web ' +
            'API, run sync --export to count it again'
        : 'nothing is staged to confirm, run sync --export first'
    );
  }
  const pathOf = _.invert(previous.names || {});
  const paths = _.compact(_.map(previous.stage, name => pathOf[name]));
  const confirmed = _.get(previous, ['confirmed', likedId]) || [];
  return {
    state: {
      ...previous,
      confirmed: { ...previous.confirmed, [likedId]: _.uniq([...confirmed, ...paths]).sort() }
    },
    count: paths.length
  };
};

// MPEG audio frame headers: bitrates (kbps) by version and layer, sample rates by version
const bitrates = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};
bitrates['2-3'] = bitrates['2-2'];
const sampleRates = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

// the frame header at offset: { version, layer, sampleRate, length }, null when the bytes are not one
const frameHeader = (buffer, offset) => {
  if (offset + 4 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
    return null;
  }
  const version = { 3: 1, 2: 2, 0: 2.5 }[(buffer[offset + 1] >> 3) & 0x03];
  const layer = { 3: 1, 2: 2, 1: 3 }[(buffer[offset + 1] >> 1) & 0x03];
  const bitrateIndex = buffer[offset + 2] >> 4;
  const rateIndex = (buffer[offset + 2] >> 2) & 0x03;
  if (!version || !layer || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
    return null;
  }
  const bitrate = bitrates[`${version === 1 ? 1 : 2}-${layer}`][bitrateIndex] * 1000;
  const sampleRate = sampleRates[version][rateIndex];
  const padding = (buffer[offset + 2] >> 1) & 0x01;
  const length =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((layer === 3 && version !== 1 ? 72 : 144) * bitrate) / sampleRate) + padding;
  return { version, layer, sampleRate, length };
};

/**
 * The MPEG audio layer of a file (1, 2, or 3): the first frame header after its ID3v2 tag that the next
 * frame follows right after (a lone sync pattern in junk data is no frame); null when none is found in
 * the first 64 KiB. Spotify's Local Files only list layer III (MP3): MP2 audio in a file named .mp3
 * never shows up there.
 */
const mpegLayer = file => {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(10);
    fs.readSync(fd, head, 0, 10, 0);
    // ID3v2 size: four 7-bit bytes, plus the 10 byte header and a footer when flagged
    const tagSize =
      head.toString('latin1', 0, 3) === 'ID3'
        ? 10 +
          ((head[6] & 0x7f) << 21) +
          ((head[7] & 0x7f) << 14) +
          ((head[8] & 0x7f) << 7) +
          (head[9] & 0x7f) +
          (head[5] & 0x10 ? 10 : 0)
        : 0;
    const buffer = Buffer.alloc(64 * 1024);
    const length = fs.readSync(fd, buffer, 0, buffer.length, tagSize);
    const data = buffer.subarray(0, length);
    for (let i = 0; i < length; i += 1) {
      const frame = frameHeader(data, i);
      const next = frame && frameHeader(data, i + frame.length);
      if (
        next &&
        next.version === frame.version &&
        next.layer === frame.layer &&
        next.sampleRate === frame.sampleRate
      ) {
        return frame.layer;
      }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
};

// whether Spotify can list a file in Local Files: MP3 audio, or a format it is not checked for
const spotifyReadable = file => {
  if (path.extname(file).toLowerCase() !== '.mp3') {
    return true;
  }
  try {
    const layer = mpegLayer(file);
    return layer === null || layer === 3;
  } catch {
    return true;
  }
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

// YYYY-MM-DD in the local time zone (toISOString gives the UTC date, a day ahead in the evening)
const localDate = date =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => `${part}`.padStart(2, '0'))
    .join('-');

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
  if (exported.unreadable && exported.unreadable.length > 0) {
    lines.push(
      `Left out, Spotify cannot list them (MPEG layer II audio in a .mp3 file; convert them to MP3):`,
      '',
      ..._.map(exported.unreadable, file => `- ${file}`),
      ''
    );
  }
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
    `${checklist(exported, { date: localDate(now) })}\n`
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
  confirmStaged,
  confirmedFiles,
  exportName,
  exportable,
  isLocalTrackOf,
  localTracks,
  mpegLayer,
  planExport,
  spotifyReadable,
  readExportState,
  writeExportState
};
