## rofi menu for the playing song

`musicman menu` opens a rofi menu for the song playing in MPD or Spotify (the desktop app). It has the
same layout for both players; the title (` Spotify` or ` MPD`), the window border and button accent
(Spotify green, MPD amber), and the status column show which one it controls. It stays open after each
action until `q` or Escape. i3 binds it to `$mod+Shift+m`.

```
 Spotify  ·  Look on Down From the Bridge
┌────────┬────────────────────────────────────────────┬─────────────┐
│ cover  │ Look on Down From the Bridge               │     Spotify │
│        │ Mazzy Star  ·  Among My Swan               │     playing │
│        │ ▶  1:23 / 3:00                             │    vol 100% │
│        │ ★★★★★  5.0   context Study   picks Nick    │  in library │
└────────┴────────────────────────────────────────────┴─────────────┘
 prev  pause  next  -10s  +10s  vol -  vol +  to MPD          p t n h l - = Tab
 shuffle on  repeat off  reshuffle Liked Songs  Study  Hot      u r o a s
 Nick's Picks  Ambient.Artists  4.0  4.5  5.0  like  ignore      d g 1 2 3 y x
```

### Which player

The one playing; Spotify when both are. With neither playing, a paused one, else a stopped MPD (so play
works). `Tab` switches to the other player while both run.

Spotify is controlled through MPRIS (`playerctl -p spotify`), so only the desktop app on this machine:
no Web API player scopes, no Premium requirement. MPD through its protocol (`mpd.host`, `mpd.port`).

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

Smart Shuffle cannot be controlled from here: neither MPRIS nor the Web API exposes it. The keys `u`,
`r`, `o`, and `g` are not given to tag buttons without a `key`.

### Following the song

While the menu is open it checks the players once a second; when another track starts (or the other
player takes over) it closes and opens again with the new song, since rofi cannot update an open menu.

### Grouping

`g` (captioned with the song's grouping) opens a second menu of the groupings used in the library, most
used first; Escape goes back. Picking one sets the grouping tag of an MPD song or a Spotify song in the
library (pushed right away, like the tag buttons). A Spotify song not in the library moves to the
`sync.playlists` playlist of that grouping (an entry whose filter is just `grouping:<value>`) and out of
the other grouping playlists; groupings without such a playlist are disabled for it.

### Song buttons

Configured in `menu.buttons` (one `field:value` of a multi value field each) and `menu.ratings`:

```yaml
menu:
  buttons:
    - label: Study
      filter: 'context:Study'
      key: a
    - label: Hot
      filter: 'picks:Hot'
  ratings: [4, 4.5, 5]
```

A highlighted button means the song has that tag (or rating). What a press does depends on the song:

| Song                                | Tag button                                                              | Rating button                                                    |
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
- Buttons without a matching `sync.playlists` entry are disabled for Spotify songs not in the library.

`like` shows whether Spotify has the track in Liked Songs now (asked each time the menu is drawn, falling
back to the cache of the last sync), so a song liked in the app is never added twice.

`like` and `ignore` apply only to Spotify songs not in the library: songs in the library are in Liked
Songs by their rating (`sync.likedRating`). `ignore` adds the track to `sync.ignorePlaylist`, whose tracks
sync never lists to pull or download and never matches a song to; it is disabled without one.

### Undo

Each press that changes something is its own archived run (`musicman logs menu`), so `musicman undo`
takes back one press at a time: the tag change and what it pushed.

### Look

`cli/share/rofi/musicman-panel.rasi`; replace it with `menu.theme`, or add rofi arguments with
`menu.rofiArgs`. Covers come from the local file (embedded picture, else `cover.jpg`/`folder.jpg` in its
folder), else Spotify's cover, cached in `$XDG_CACHE_HOME/musicman/covers`. Errors are shown as
notifications, since there is no terminal when it is opened from a keybinding.
