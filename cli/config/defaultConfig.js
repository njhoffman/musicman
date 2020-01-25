module.exports = {
  delimiter: ',',
  playlist: {
    outputPath: `default.m3u`,
    outputDirectory: '.mpd/playlists/'
  },
  mpd: {
    port: 6600,
    host: 'localhost',
    baseDirectory: '/Music/Sorted'
  },
  rating: {
    tag: 'POPM',
    email: 'Default',
    max: 5
  },
  output: {
    table: {
      headers: {
        visible: true,
        capitalize: false
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
      id: 'TCON',
      name: 'genre'
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
    }
    // "albumArtist": "TXXX=AlbumArtist",
    // "releaseType": "TXXX=ReleaseType", (integer)
    // "volumeAdjust": "TXXX=replaygain_track_gain", ("-8.80 dB")
  ]
};
