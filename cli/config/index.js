// TODO: replace with loading from ~/.musicman/cli or default config
// TODO: validate configuration, prevent reserved tag names

// reserved tagNames: rating
module.exports = {
  delimiter: ',',
  playlist: {
    // outputPath: `${new Date().toISOString()}.m3u`,
    outputPath: `current.m3u`,
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
    max: 5,
    color: '#BBDDFF'
  },
  output: {
    table: {
      color: '#BBBBBB',
      headers: {
        visible: true,
        capitalize: false,
        color: '#00FF88'
      },
      seperators: {
        vertical: false,
        horizontal: false
        // color: '#88AABB'
      }
    }
    // vertical: {
    //   color: 'gray',
    //   headers: {
    //     visible: true,
    //     color: 'white'
    //   },
    // }
  },
  tags: [
    {
      id: 'TPE1',
      name: 'artist',
      tableOrder: 1
    },
    {
      id: 'TIT2',
      name: 'title',
      tableOrder: 2,
      maxWidth: 30
    },
    {
      id: 'TALB',
      name: 'album',
      tableOrder: 3,
      maxWidth: 20
    },
    {
      id: 'TXXX.Context',
      name: 'context',
      tableOrder: 4,
      multi: true
    },
    {
      id: 'TXXX.Mood',
      name: 'mood',
      tableOrder: 5,
      multi: true
    },
    {
      id: 'TXXX.Picks',
      name: 'picks',
      tableOrder: 6,
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
      name: 'grouping' // artist, compilation, single
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
