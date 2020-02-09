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
  daemon: {
    duration: 5000,
    bin: '/usr/bin/notify-send',
    urgency: 'LOW',
    icon: false,
    fields: ['artist', 'context', 'mood']
  },
  rating: {
    tag: 'POPM',
    email: 'Default',
    max: 5
  },
  output: {
    verbosity: 4, // 0-4
    padding: 1,
    table: {
      headers: {
        visible: true,
        capitalize: false
      },
      seperators: {
        vertical: false,
        horizontal: false
      }
    },
    vertical: {
      headers: {
        visible: true
      }
    }
  },
  stats: {
    multiFields: ['context', 'mood'],
    filters: [
      { name: 'All Songs > 4.0', filter: 'rating:4.0' },
      { name: 'All Songs > 4.5', filter: 'rating:4.5' },
      { name: 'All Songs > 5.0', filter: 'rating:5.0' },
      { name: 'Singles > 4.0', filter: 'rating:4.0 type:singles' },
      { name: 'Total', filter: 'rating:5.0' }
    ]
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
    }
    // "albumArtist": "TXXX=AlbumArtist",
    // "releaseType": "TXXX=ReleaseType", (integer)
    // "volumeAdjust": "TXXX=replaygain_track_gain", ("-8.80 dB")
  ]
};
