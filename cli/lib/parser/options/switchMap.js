module.exports = {
  recursive: {
    description: 'Apply or show files in all subdirectories of target directory',
    alias: '-r',
    func: () => ({ recursive: true })
  },
  norecursive: {
    description: 'Apply or show files in all subdirectories of target directory',
    alias: '-nr',
    func: () => ({ recursive: false })
  },
  include: {
    description: 'Only show these comma-seperated field names in output',
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
  review: {
    description: 'List probable Spotify matches waiting for review',
    alias: '-R',
    func: () => ({ review: true })
  },
  'dry-run': {
    description: 'Show what would change without writing files, the database, or Spotify',
    alias: '-n',
    func: () => ({ dryRun: true })
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
