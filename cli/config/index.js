// TODO: replace with loading from ~/.musicman/cli or default config
// TODO: validate configuration, prevent reserved tag names

// reserved tagNames: rating
module.exports = {
  delimiter: ',',
  playlist: {
    outputPath: `${new Date().toISOString()}.m3u`,
    outputDirectory: '/home/nicholas/.mpd/playlists/'
  },
  mpd: {
    port: 6600,
    host: 'localhost',
    baseDirectory: '/home/nicholas/Music/Sorted'
  },
  rating: {
    tag: 'POPM',
    email: 'Default',
    max: 5
  },
  tags: [
    {
      id: 'TPE1',
      name: 'artist',
      viewIndex: 1
    },
    {
      id: 'TIT2',
      name: 'title',
      viewIndex: 2
    },
    {
      id: 'TALB',
      name: 'album',
      viewIndex: 3
    },
    {
      id: 'TXXX.Context',
      name: 'context',
      viewIndex: 4,
      multi: true
    },
    {
      id: 'TXXX.Mood',
      name: 'mood',
      viewIndex: 5,
      multi: true
    },
    {
      id: 'TXXX.Picks',
      name: 'picks',
      viewIndex: 6,
      multi: true
    },
    {
      id: 'TCON',
      name: 'genre'
    },
    {
      id: 'TDRL',
      name: 'year' // TYER?
    },
    {
      id: 'TRCK',
      name: 'track'
    },
    {
      id: 'TXXX.PrimaryGenre',
      name: 'primary'
    },
    {
      id: 'TXXX.SecondaryGenre',
      name: 'secondary'
    },
    {
      id: 'TIT1',
      name: 'grouping'
    },
    {
      id: 'TCOP',
      name: 'copyright'
    },
    {
      id: 'TXXX.CompositionType',
      name: 'compositionType'
    }
    // "albumArtist": "TXXX=AlbumArtist",
    // "releaseType": "TXXX=ReleaseType", (integer)
    // "volumeAdjust": "TXXX=replaygain_track_gain", ("-8.80 dB")
  ]
};
