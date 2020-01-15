// TODO: replace with loading from ~/.musicman/cli or default config
// TODO: validate configuration, prevent reserved tag names

// reserved tagNames: rating
module.exports = {
  delimiter: ',',
  playlist: {
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
      viewIndex: 4
    },
    {
      id: 'TXXX.Mood',
      name: 'mood',
      viewIndex: 5
    },
    {
      id: 'TXXX.Picks',
      name: 'picks',
      viewIndex: 6
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

// IDv2 tag info for 01 - Bulletproof (Nacey remix).mp3
// TALB=LazerProof
// TBPM=0
// TCMP=0
// TCOM=Elly Jackson, Ben Langmaid
// TCON=Electronic
// TDOR=2010-05-26
// TDRC=2010-05-26
// TEXT=Elly Jackson, Ben Langmaid
// TIPL=[unrepresentable data]
// TIT2=Bulletproof (Nacey remix)
// TLAN=eng
// TMED=Digital Media
// TPE1=Major Lazer & La Roux feat. Matthew Hemerlein
// TPE2=Major Lazer & La Roux
// TPOS=1/1
// TPUB=Mad Decent
// TRCK=1/14
// TSOC=Jackson, Elly, Langmaid, Ben
// TSOP=Major Lazer & Roux, La feat. Hemerlein, Matthew
// TSSE=Lavf58.20.100
// TXXX=ALBUM ARTIST=Major Lazer & La Roux
// TXXX=ALBUMARTISTSORT=Major Lazer & Roux, La
// TXXX=ALBUMARTIST_CREDIT=Major Lazer & La Roux
// TXXX=ARTISTSORT=Major Lazer & Roux, La feat. Hemerlein, Matthew
// TXXX=ARTIST_CREDIT=Major Lazer & La Roux feat. Matthew Hemerlein
// TXXX=Album Artist Credit=Major Lazer & La Roux
// TXXX=Artist Credit=Major Lazer & La Roux feat. Matthew Hemerlein
// TXXX=BPM=0
// TXXX=COMPOSERSORT=Jackson, Elly, Langmaid, Ben
// TXXX=DISCC=1
// TXXX=DISCTOTAL=1
// TXXX=LABEL=Mad Decent
// TXXX=LABELNO=MAD 003
// TXXX=LYRICIST=Elly Jackson, Ben Langmaid
// TXXX=MEDIA=Digital Media
// TXXX=MUSICBRAINZ_ALBUMARTISTID=75be165a-ad83-4d12-bd28-f589a15c479f
// TXXX=MUSICBRAINZ_ALBUMID=0153c6dd-c335-498c-b298-4eb2e33ee41c
// TXXX=MUSICBRAINZ_ALBUMSTATUS=Official
// TXXX=MUSICBRAINZ_ALBUMTYPE=album
// TXXX=MUSICBRAINZ_ARTISTID=75be165a-ad83-4d12-bd28-f589a15c479f
// TXXX=MUSICBRAINZ_RELEASEGROUPID=d8720223-a6c0-4d4e-be9c-1ecb125e781a
// TXXX=MUSICBRAINZ_RELEASETRACKID=4bbff308-f527-319b-944b-8e0d97542626
// TXXX=MUSICBRAINZ_TRACKID=ec760244-489c-44c7-ade4-548f6d65ec54
// TXXX=MusicBrainz Album Artist Id=75be165a-ad83-4d12-bd28-f589a15c479f
// TXXX=MusicBrainz Album Id=0153c6dd-c335-498c-b298-4eb2e33ee41c
// TXXX=MusicBrainz Album Release Country=XW
// TXXX=MusicBrainz Album Status=Official
// TXXX=MusicBrainz Album Type=album
// TXXX=MusicBrainz Artist Id=75be165a-ad83-4d12-bd28-f589a15c479f
// TXXX=MusicBrainz Release Group Id=d8720223-a6c0-4d4e-be9c-1ecb125e781a
// TXXX=MusicBrainz Release Track Id=4bbff308-f527-319b-944b-8e0d97542626
// TXXX=ORIGINALDATE=2010-05-26
// TXXX=RELEASECOUNTRY=XW
// TXXX=SCRIPT=Latn
// TXXX=TCMP=0
// TXXX=TOTALDISCS=1
// TXXX=TOTALTRACKS=14
// TXXX=TRACKC=14
// TXXX=TRACKTOTAL=14
// TXXX=YEAR=2010
// UFID=http://musicbrainz.org=b'ec760244-489c-44c7-ade4-548f6d65ec54'
// USLT==XXX=
//

// IDv2 tag info for ./01 - Mouthful Of Diamonds.mp3
// APIC=cover front, Received picture (Album) (image/jpg, 50105 bytes)
// POPM=Default=None 255/255
// POPM=no@email=0 255/255
// TALB=Eyelid Movies
// TCOM=Phantogram
// TCON=[Electronica] Indietronica & Trip-Hop
// TDRL=2009
// TIT1=Nick's Picks,Pool,Drive,Lounge,Study,Parent's Party,
// TIT2=Mouthful Of Diamonds
// TPE1=Phantogram
// TPE2=Phantogram
// TRCK=1
// TSRC=GBEQT0901156
// TXXX=AlbumArtist=Phantogram
// TXXX=ReleaseType=2
// TXXX=replaygain_track_gain=-9.39 dB
// TXXX=replaygain_track_peak=0.999969
// TYER=2009

// IDv2 tag info for 11 - Lucky.mp3
// APIC=cover front, Radiohead - Lucky (image/jpg, 23989 bytes)
// COMM==ENG=OK Computer is the third album by the English rock band Radiohead, released in 1997. The album's themes of alienation from the modern world, combined with an expansive sound, made it a commercial success and propelled Radiohead to worldwide popularity. The album reached #1 on the UK Albums Chart and marked Radiohead's highest entry in the American market at the time, where it debuted at #21, and has sold 1.9 million copies there to date.  The album, recorded with producer Nigel Godrich in Didcot, Oxfordshire and in Bath, England, propelled Godrich to fame, establishing him as a producer. Because of its unexpected success, OK Computer became the last Radiohead album with a delayed release outside of the United Kingdom.
// Radiohead released three singles from OK Computer, "Paranoid Android", "Karma Police", and "No Surprises", which were all successes in the United Kingdom. "Karma Police", however, turned out to become one of the band's biggest hits since their 1993 debut single, "Creep", reaching #14 on the US Modern Rock chart, propelling the band to stardom in America. Although OK Computer, along with its singles, was seen to put the group at the forefront of modern rock music, it departed from the Britpop and alternative rock styles popular at the time, laying the groundwork for the band's later, more abstract albums.
// .....
// POPM=Default=None 204/255
// POPM=no@email=0 204/255
// TALB=OK Computer
// TCOM=Radiohead
// TCON=[Rock] Indie Rock
// TDRL=1997
// TIT1=Nick's Picks,Study,Pool,Drive,Lounge,
// TIT2=Lucky
// TMED=Official Release / Composition Year
// TMOO=Cold, Epic, Sprawling, Austere, Paranoid, Tense/Anxious, Cathartic, Distraught, insular, Suffocating, Atmospheric, Brooding, Angst-Ridden, Melancholy, Eerie, Theatrical, Wintry, Wistful, Hypnotic, Detached, Enigmatic
// TPE1=Radiohead
// TPE2=Radiohead
// TPUB=Parlophone
// TRCK=11
// TXXX=AlbumArtist=Radiohead
// TXXX=Comment=Radiohead are an English roc
// TXXX=PREFERENCE=Recorded by Artist(s)
// TXXX=PartOfSeries=Alternative Pop/Rock, Britpop, Indie Electronic
// TXXX=ReleaseType=2
// TXXX=replaygain_album_gain=-8.15 dB
// TXXX=replaygain_track_gain=-7.12 dB
// TXXX=replaygain_track_peak=1.000000
// TYER=1997
// UFID=http://www.cddb.com/id3/taginfo1.html='3CD3N49R93172204U3781045B2F6E454AC6D2F45819B314E8E35P0\x00'

//
// IDv2 tag info for 03 - Summer Skin.mp3
// APIC=cover front, Death Cab For Cutie - Marching Bands Of Manhattan (image/jpg, 5949 bytes)
// COMM==ENG=Plans is the fifth studio al
// COMM=Album Description=ENG=Plans is the fifth studio album by Death Cab for Cutie, released on August 30, 2005. Drummer Jason McGerr noted the continuity between this album and their previous one, stating "if Transatlanticism was an inhale, Plans is the exhale." In 2006, a DVD was released titled Directions, an anthology of 11 short films all inspired by tracks of Plans.
// POPM=Default=None 255/255
// POPM=no@email=0 255/255
// TALB=Plans
// TCOM=Death Cab for Cutie
// TCON=[Rock] Indie Rock
// TCOP=Mellow,
// TDRL=2005
// TENC=iTunes v4.9
// TIT1=Nick's Picks,Lounge,Study,Pool,Running,Coitus,Emily's Picks,Ali's Picks,Parent's Party,
// TIT2=Summer Skin
// TPE1=Death Cab For Cutie
// TPE2=Death Cab for Cutie
// TRCK=3
// TXXX=AlbumArtist=Death Cab for Cutie
// TXXX=Comment=Plans is the fifth studio al
// TXXX=ReleaseType=2
// TXXX=replaygain_album_gain=-6.64 dB
// TXXX=replaygain_track_gain=-5.62 dB
// TXXX=replaygain_track_peak=1.000000
// TYER=2005
