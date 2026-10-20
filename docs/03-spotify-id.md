## spotify sync command

- new 'sync' command
- read beets config for path details: ~/.config/beets/config.yaml
  - beets attempts to automatically assign tags for all files and moves them to 'Sorted/Unrated' folder
  - after I rate it and assign it a genre 'grouping', it gets moved to 'Sorted/Rated'
  - beets can't always identify, especially songs, so additional identification is needed in this library
  - i would like this library to act as a wrapper for the beets program so I don't have to manually do it, and augment
    it's specifically for spotify
- beets spotify plugin should assign matching spotify ids ids to local 'Rated' songs, but it may miss some so we will
  need to look up the song in spotify from here as well
- 'beets spotifysync' is supposed to also fill out the following custom tags:
  - acousticness danceability energy instrumentalness key liveness loudness mode speechiness tempo time_signature valence
  - try to populate these from spotify along with any other spotify specific tags
- if still not found, it will need to be marked for upload it to spotify
- all local songs rating 4.5 and above should be added to 'Liked Songs' playlist in spotify
- if song exists in spotify, but not locally, download it, assign the tags you can
  - we will use 'beet import --singletons' to move it into 'Sorted/Unrated/_Singles' folder
  - I will then manually rate it and add other tags, then import it into the Rated folder (it's never a full album download so always treated a single)
- spotify playlist items will be cached locally, 'sync' command without arguments will refresh the cache and output the
  number of songs that will be pulled from spotify and pushed to spotify
- 'sync --pull' will confirm with the user to 'download # of songs'
  - if yes will begin the process with visual progress bar indicator and ability to cancel and resume, output each song
    downloaded (assign available tags plus any tags the playlists are associated with from fields below)
- 'sync --push' will confirm with the user to 'upload # of songs' and 'add # songs to playlist a' 'add # songs to playlist b'
- if yes will begin the process with visual progress bar , can be canceled and resumed, show each song uploaded or
  assigned to a playlist from fields below

### Design decisions (agreed 2026-10-20)

- **Credentials**: `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from the environment, or `spotify.clientId`
  and `spotify.clientSecret` in the config; the environment takes precedence. OAuth tokens are stored outside
  the config file.
- **Upload (push)**: the Spotify Web API cannot upload audio or add local files to playlists, so musicman
  exports songs that are not on Spotify to `sync.uploadDirectory` for the desktop app's Local Files:
  - one subfolder per target playlist (including Liked Songs); a song in several playlists is in each folder
  - hardlinks when on the same filesystem as the library, copies otherwise
  - `README.md` checklist in the export directory grouped by playlist, the same summary printed by `sync --push`
  - the Web API can read local tracks in playlists, so the next `sync` verifies what was added, reports what is
    still missing, and removes completed items from the export directory
  - verify first: whether each subfolder must be added as its own Local Files source and can be toggled
  - local files only play on other devices on the same network with the playlist downloaded
- **Download (pull)**: a separate spotDL script, not run inline:
  - `sync --pull` writes a manifest (track URL, target playlist, tags to apply) to `sync.downloadDirectory`
  - the script downloads the manifest with spotDL (installed: 4.5.2) into `sync.downloadDirectory`, using
    `{track-id}` in the output template; a rerun skips existing files, which gives cancel and resume
  - spotDL writes ID3v2.3 and the Spotify track URL in `WOAS`, matching the library's tag version
  - `sync --import` matches files to manifest entries by track id, writes the Spotify id and playlist tags,
    imports with `beet import -s -q --quiet-fallback=asis -l <log>` into `Sorted/Unrated/_Singles`, reports
    files beets logged as untaggable, and updates the database
  - spotDL downloads audio from YouTube, which is against YouTube's terms of service
- **Config**: `spotify.clientId`, `spotify.clientSecret`, `sync.uploadDirectory`, `sync.downloadDirectory`,
  `sync.spotdlCommand`.

*the map below shows the association between id3 tags and spotify playlists (ignore empty ones for now)*

```

grouping:AlternativeMetal.Artists         : https://open.spotify.com/playlist/5MUDXMSHkjbA2CIYXjj1Vz?si=a9900a672c9c4839 
grouping:AlternativeRock.Artists          : https://open.spotify.com/playlist/5ewgiAwSOXnUpiTZ0SKqpW?si=6c8d6ad075e6458b 
grouping:FolkRock.Artists                 : https://open.spotify.com/playlist/5suA7TaRaQV9RMrwHwai5k?si=eabdc55ac0254c9e 
grouping:BluesRock.Artists                : https://open.spotify.com/playlist/4tmSDP6DgQ6HLR83OMIEDU?si=afe888cea3bf4852 
grouping:IndieRock.Artists                : https://open.spotify.com/playlist/25khvbDJw6mVwq4sxA6Tje?si=3793936a06564b30 
grouping:PopRock.Artists                  : https://open.spotify.com/playlist/1Ft9uzUi8V3lfHYo9Slwzf?si=6941831ff7f24070 
grouping:PsychedelicRock.Artists          : https://open.spotify.com/playlist/5IsYgxQ55USPYtSyxckHtG?si=7d32ea87c5524df8 
grouping:Ambient.Artists                  : https://open.spotify.com/playlist/3TqkPqQr9BzqYHWPakGh4h?si=56f39b7a34d0482d 
grouping:Bigbeat.Artists                  : https://open.spotify.com/playlist/0uyh7GfVAoNw3KOuKZ75MN?si=5a3923b92da645b1
grouping:Downbeat.Artists                 : https://open.spotify.com/playlist/3MeNGaelRObH38Pn1QMTCW?si=6c184badb7fe4252 
grouping:ElectronicFunk.Artists           : https://open.spotify.com/playlist/54f3pcHrRHN8CZbgGOa1Ay?si=24ee1d1c0843492f 
grouping:Indietronica.Artists             : https://open.spotify.com/playlist/2TcZfc2ukOPm1eGKAN10Lp?si=23519c463b014340
grouping:ContemporaryInstrumental.Artists : https://open.spotify.com/playlist/6LWuI0FmBZspZHTseDjCPI?si=e9f33aea59124ff9 
grouping:Rap-R&B.Artists                  : https://open.spotify.com/playlist/2cQdlc9kWYaH2Vn7wDpXiF?si=55f43849da6840e9 
grouping:AlternativeMetal.Singles         : https://open.spotify.com/playlist/5MUDXMSHkjbA2CIYXjj1Vz?si=a9900a672c9c4839 
grouping:AlternativeRock.Singles          : https://open.spotify.com/playlist/5ewgiAwSOXnUpiTZ0SKqpW?si=6c8d6ad075e6458b 
grouping:FolkRock.Singles                 : https://open.spotify.com/playlist/5suA7TaRaQV9RMrwHwai5k?si=eabdc55ac0254c9e 
grouping:BluesRock.Singles                : https://open.spotify.com/playlist/4tmSDP6DgQ6HLR83OMIEDU?si=afe888cea3bf4852 
grouping:IndieRock.Singles                : https://open.spotify.com/playlist/25khvbDJw6mVwq4sxA6Tje?si=3793936a06564b30 
grouping:PopRock.Singles                  : https://open.spotify.com/playlist/1Ft9uzUi8V3lfHYo9Slwzf?si=6941831ff7f24070 
grouping:PsychedelicRock.Singles          : https://open.spotify.com/playlist/5IsYgxQ55USPYtSyxckHtG?si=7d32ea87c5524df8 
grouping:Ambient.Singles                  : https://open.spotify.com/playlist/3TqkPqQr9BzqYHWPakGh4h?si=56f39b7a34d0482d 
grouping:Bigbeat.Singles                  : https://open.spotify.com/playlist/0uyh7GfVAoNw3KOuKZ75MN?si=5a3923b92da645b1
grouping:Downbeat.Singles                 : https://open.spotify.com/playlist/3MeNGaelRObH38Pn1QMTCW?si=6c184badb7fe4252 
grouping:ElectronicFunk.Singles           : https://open.spotify.com/playlist/54f3pcHrRHN8CZbgGOa1Ay?si=24ee1d1c0843492f 
grouping:Indietronica.Singles             : https://open.spotify.com/playlist/2TcZfc2ukOPm1eGKAN10Lp?si=23519c463b014340
grouping:ContemporaryInstrumental.Singles : https://open.spotify.com/playlist/6LWuI0FmBZspZHTseDjCPI?si=e9f33aea59124ff9 
grouping:Rap-R&B.Singles                  : https://open.spotify.com/playlist/2cQdlc9kWYaH2Vn7wDpXiF?si=55f43849da6840e9 

context:Code 
context:Coitus        : https://open.spotify.com/playlist/1W2322kKmTEbGdpl785zxi?si=ce6287905da9499a
context:Drive 
context:FixEnding 
context:Float 
context:Heroin 
context:Instrumental 
context:Lift          : https://open.spotify.com/playlist/3JKVlTuOn2XId92u6tOVAG?si=d00347fdfa58437a
context:Lounge 
context:Mellow 
context:Morning       : https://open.spotify.com/playlist/6uaBcSaUy7ZkKFEn4NZO1Y?si=aedc3268f3d946a5 
context:Party 
context:Pool 
context:Relax         : https://open.spotify.com/playlist/2V4Bgf9XSJpYLaz1O67usg?si=4b8df3a4c59b481c 
context:Run           : https://open.spotify.com/playlist/2euVje5AhJnoKqUAlzzNs8?si=ef74da987e904531
context:Sleep 
context:Smoke 
context:Study         : https://open.spotify.com/playlist/6hik9wlDckKrPZ9FTusxJH?si=a8f3167fb34846dd
context:Upbeat 

mood:Bluesy
mood:Chill
mood:Dark
mood:Dirt
mood:Dreamy
mood:Driving
mood:Energetic
mood:Ethereal
mood:Folksy
mood:Gloomy
mood:Groovy
mood:Happy
mood:Hardcore
mood:Intense
mood:Mellow
mood:Study         
mood:Trippy
mood:Ubpeat
mood:Upbeat
mood:Uplifting
mood:Very Mellow 

picks:Guitar
picks:Hot          : https://open.spotify.com/playlist/0n9JG8Dm0RUQZohcEsfVfu?si=37361b7d8cd34eaa 
picks:Spicy        : https://open.spotify.com/playlist/4R9tgnxcLrHm80LGZyE8zu?si=ecd300ec95644c4a
picks:Jeremy
picks:Mom          : https://open.spotify.com/playlist/3rmuFEuTnVicLT5j0xulry?si=a5f7716245dd4170
picks:Nick         : https://open.spotify.com/playlist/6S6tNQHzOu2KdyMWwrttsw?si=c2e95eba62c34544

```
