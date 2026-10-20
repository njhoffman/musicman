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
  update: {
    description: 'Update the database from the mpd base directory or the target directory',
    alias: '-u',
    func: () => ({ update: true })
  }
};
