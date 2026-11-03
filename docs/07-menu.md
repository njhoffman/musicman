## rofi menu for the playing song

`musicman menu` opens a rofi menu for the song playing in MPD or Spotify (the desktop app). It has the
same layout for both players; the title (` Spotify` or ` MPD`), the window border, the playback icons
(Spotify green, MPD amber), and the status column show which one it controls. It opens with `next`
selected, so Enter right away skips the song, and stays open after each action until `q` or Escape. i3
binds it to `$mod+Shift+m`.

```
 Spotify
┌──────────┬──────────────────────────────────────────────┬─────────────┐
│          │ Look on Down From the Bridge                 │     Spotify │
│  cover   │ Mazzy Star  ·  Among My Swan                 │     playing │
│          │ ▶  1:23  ━━━━━━━━━●──────────────────  3:00  │    vol 100% │
│          │ ★★★★★  5.0      FolkRock.Artists      1996   │  in library │
│          │  Study    Drive    Mellow    Nick          │             │
└──────────┴──────────────────────────────────────────────┴─────────────┘
 prev  pause  next  -30s  +30s  vol -  vol +  shuffle  repeat       p t n h l - = u r
 reshuffle  details  genre  tags  4.0  4.5  5.0  like  ignore       o i g e 1 2 3 y x
```

The song's tags are shown as chips colored per field (context blue, mood purple, picks red); icons are
colored per kind of button (playback, modes, song, ratings, like).

### Which player

The one playing; Spotify when both are. With neither playing, a paused one, else a stopped MPD (so play
works). The menu follows whichever player takes over (see Following the song); there is no switch.

The Spotify desktop app on this machine is controlled through MPRIS (`playerctl -p spotify`). Spotify
playing on another device (a phone, a speaker) is controlled through the Web API player endpoints
(Premium, the playback scopes of `sync --login`), and the title names the device (` Spotify · Pixel 7`).
The Web API is asked only when neither the desktop app nor MPD is playing, so the menu makes no Web API
calls while following local playback; another device playing comes before a paused local player, and
paused after one. Devices without remote volume have the volume buttons disabled. MPD through its
protocol (`mpd.host`, `mpd.port`). Seek moves 30 seconds. `musicman player` picks players the same way.

A Spotify local file (a song added with `sync --export`) has no Spotify id, so the menu finds its library
song by title, artist, and length (within 2 seconds; the same album first when there are copies), as the
export does. Found, it acts like an MPD song: tags and ratings are written to the file and nothing is
pushed (the next `sync --export` stages it for any playlist a change puts it in). Not found, it shows as
not in the library, with like and ignore disabled. `musicman status` and the song notifications find it
the same way.

### Shuffle, repeat, and reshuffle

After the playback controls:

- `u` shuffle: toggles Spotify's shuffle, or MPD's random; highlighted when on.
- `r` repeat: steps through off, playlist, and track (MPD: repeat, then repeat with single); highlighted
  when not off.
- `o` reshuffle (Spotify): runs `musicman shuffle` for the playlist or Liked Songs that is playing (from
  the Web API), else for the last `musicman shuffle` source (albums, artists, the shuffle playlist itself,
  and track lists fall back to it), writing a new random order and playing it with shuffle off. The
  caption names the source; disabled when there is neither. Why this beats Spotify's own shuffle: the
  README's "Spotify shuffle" section.

Smart Shuffle cannot be controlled from here: neither MPRIS nor the Web API exposes it.

### Following the song

While the menu is open it checks the players once a second; when another track starts (or the other
player takes over) it closes and opens again with the new song, since rofi cannot update an open menu.

### Submenus

`i` details, `g` genre, and `e` tags open a second menu over the same song panel. Their buttons are plain
text, and typing filters them (rofi matches the raw text of a button, so the main menu, drawn with
markup, has no filter). Escape goes back to the main menu.

### Details

`i` lists everything about the song, one line each: for a song in the library its file (path, size,
modified) and every tag with a value, Spotify fields included; for a Spotify song not in the library the
track as Spotify plays it. Then its Spotify link and URI and the cached Spotify playlists it is in.
Enter on a line copies its value (the path, the link; not the field name) to the clipboard, with
`wl-copy` under Wayland, else `xclip`, and goes back to the main menu.

### Genre

`g` (captioned with the song's grouping, `genre` when it has none) opens the groupings used in the
library, most used first. Picking one sets the grouping tag of an MPD song or a Spotify song in the
library (pushed right away, like tags). A Spotify song not in the library moves to the `sync.playlists`
playlist of that grouping (an entry whose filter is just `grouping:<value>`) and out of the other grouping
playlists; groupings without such a playlist are disabled for it.

### Tags

`e` (captioned with how many tags the song has) opens every value of `menu.tagFields` (picks, context and
mood by default) used on at least `menu.tagMinSongs` songs (5), most used first per field, with the
song's own values and `menu.extraTags` (values no song has yet) added. `menu.buttons` are pinned first,
pressed with Alt and their key (`Alt+a`, shown as `M-a`), since plain letters filter. A highlighted tag
(✓) is one the song has; pressing a tag adds or removes it, and the menu stays open with the song read
again, so several tags can be changed in a row.

```yaml
menu:
  buttons:
    - label: Study
      filter: 'context:Study'
      key: a
    - label: Hot
      filter: 'picks:Hot'
  tagFields: [picks, context, mood]
  tagMinSongs: 5
  extraTags: ['mood:Nostalgic']
  ratings: [4, 4.5, 5]
```

### Tag and rating buttons

What a tag or rating press does depends on the song:

| Song                                | Tag                                                                     | Rating button                                                    |
| ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| MPD                                 | adds or removes the value (`context=+Study`)                            | sets the rating                                                  |
| Spotify, in the library (by its id) | the same local change, then pushed right away                           | the same, pushed right away                                      |
| Spotify, not in the library         | adds to or removes from the `sync.playlists` entry with the same filter | moves it to the playlist of that exact rating (`rating:4.5-4.5`) |

- A rating is set, never cleared, from the menu: the current rating's button is disabled.
- The push for a song in the library only touches the targets the change moved it into or out of, and
  keeps the track where another copy of the song still belongs. Playlists are refreshed first, so a
  track is never added twice. Songs outside `sync.scope` are not pushed.
- A Spotify song not in the library that is in a rating playlist gets that rating when `sync --pull`
  and `sync --import` bring it in.
- Tags without a matching `sync.playlists` entry are disabled for Spotify songs not in the library.
- A song in `Unrated` that a press gives its last missing piece (a rating, with a grouping or the grouping
  hint of a download) is filed away by beets right away, like `musicman sort` does, and a notification
  says where it went. The menu keeps reading it from there for the rest of the session, also for the push.
- A rating or grouping playlist the song's copies disagree on is skipped by the push, with a notification
  (see `05-spotify-push.md`).

`like` shows whether Spotify has the track in Liked Songs now (asked each time the menu is drawn, falling
back to the cache of the last sync), so a song liked in the app is never added twice.

`like` and `ignore` apply only to Spotify songs not in the library: songs in the library are in Liked
Songs by their rating (`sync.likedRating`). `ignore` adds the track to `sync.ignorePlaylist`, whose tracks
sync never lists to pull or download and never matches a song to; it is disabled without one.

### Undo

Each press that changes something is its own archived run (`musicman logs menu`), so `musicman undo`
takes back one press at a time: the tag change and what it pushed.

### Song change notifications

The `musicman-notify` user service (`pnpm daemon:install`, then
`systemctl --user enable --now musicman-notify`) shows a notification when a new track starts in MPD or
the Spotify desktop app; pausing, seeking, or the volume never notify, and each notification replaces the
last. The summary is the rating as stars and the title; the body the artist and album, then the song's
`daemon.fields` (context, mood, picks by default) as tags colored like the menu's, or `not in library`
for a Spotify song without a library match (by its Spotify id). The icon is the cover (`daemon.icon`), the
same one the menu shows, and the app name is the player (`MPD` or `Spotify`), for notification server
rules per player.

MPD is watched over its idle connection, reconnecting when MPD restarts; Spotify through MPRIS
(`playerctl -p spotify --follow`), which keeps waiting while Spotify is closed.

### Look

`cli/share/rofi/musicman-panel.rasi`; replace it with `menu.theme`, or add rofi arguments with
`menu.rofiArgs`. Covers come from the local file (embedded picture, else `cover.jpg`/`folder.jpg` in its
folder), else Spotify's cover, cached in `$XDG_CACHE_HOME/musicman/covers`. Errors are shown as
notifications, since there is no terminal when it is opened from a keybinding.
