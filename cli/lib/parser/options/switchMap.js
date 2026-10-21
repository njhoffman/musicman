module.exports = {
  recursive: {
    description: 'Apply or show files in all subdirectories of target directory',
    alias: '-r',
    func: () => ({ recursive: true })
  },
  norecursive: {
    description: 'Only apply or show files directly in the target directory',
    alias: '-nr',
    func: () => ({ recursive: false })
  },
  include: {
    description: 'Only show these comma-separated field names in output',
    alias: '-i',
    examples: ['-i artist,title', '-i "artist,album type"'],
    func: (used, optionList, i) => {
      used.push(optionList[i + 1]);
      return { include: optionList[i + 1].split(',') };
    }
  },
  exclude: {
    description: 'Field names to omit from output',
    alias: '-x',
    examples: ['-x album', '-x "Album Artist"'],
    func: (used, optionList, i) => {
      used.push(optionList[i + 1]);
      return { exclude: optionList[i + 1].split(',') };
    }
  },
  write: {
    description: 'File name/path of the playlist to write',
    alias: '-w',
    examples: ['-w party', '-w "Folder Name/Party Songs"'],
    func: (used, optionList, i) => {
      used.push(optionList[i + 1]);
      return { write: optionList[i + 1] };
    }
  },
  format: {
    description: 'Output format: default, oneline (colored, one line per item), csv, json, or html',
    alias: '-o',
    value: 'format',
    examples: ['--format=csv', '-o json', '--format oneline'],
    func: (used, optionList, i) => {
      used.push(optionList[i + 1]);
      return { format: optionList[i + 1] };
    }
  },
  fzf: {
    description: 'Pick from the oneline output with fzf and print the picked keys (paths, run ids)',
    alias: '-z',
    func: () => ({ fzf: true })
  },
  files: {
    description: 'Read tags from the files instead of the library database',
    alias: '-f',
    func: () => ({ files: true })
  },
  add: {
    description: 'Add search results to the MPD queue',
    alias: '-a',
    func: () => ({ add: true })
  },
  play: {
    description: 'Replace the MPD queue with search results and play them',
    alias: '-p',
    func: () => ({ play: true })
  },
  match: {
    description: 'Find Spotify track ids for songs that belong in Liked Songs or a mapped playlist',
    alias: '-m',
    func: () => ({ match: true })
  },
  refresh: {
    description: 'With --match, fetch the Spotify fields of every matched song again',
    alias: '-F',
    func: () => ({ refresh: true })
  },
  verbose: {
    description: 'With --match, list every field written, filled, and kept under each song',
    alias: '-v',
    func: () => ({ verbose: true })
  },
  review: {
    description: 'List probable Spotify matches waiting for review',
    alias: '-R',
    func: () => ({ review: true })
  },
  'dry-run': {
    description:
      'Show what would change without writing files or Spotify (sync --match still caches its lookups)',
    alias: '-n',
    func: () => ({ dryRun: true })
  },
  push: {
    description: 'Add songs to Spotify Liked Songs and mapped playlists',
    alias: '-P',
    func: () => ({ push: true })
  },
  pull: {
    description: 'Write a download manifest of Spotify tracks that are not in the library',
    alias: '-d',
    func: () => ({ pull: true })
  },
  import: {
    description:
      'Tag the downloads of the sync --pull manifest with their Spotify fields and playlist tags, then import them with beets',
    alias: '-I',
    func: () => ({ import: true })
  },
  prune: {
    description: 'With --push, also remove tracks whose song no longer belongs in the playlist',
    alias: '-X',
    func: () => ({ prune: true })
  },
  login: {
    description: 'Log in to Spotify for playlist sync',
    alias: '-L',
    func: () => ({ login: true })
  },
  backup: {
    description: 'Back up the library database now',
    alias: '-b',
    func: () => ({ backup: true })
  },
  update: {
    description: 'Update the database from the mpd base directory or the target directory',
    alias: '-u',
    func: () => ({ update: true })
  }
};
