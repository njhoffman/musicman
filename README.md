# musicman

An mp3 library manager for MPD, beets, and Spotify. It reads and writes ID3 tags (ratings, groupings,
multi value fields like `context` and `mood`), keeps a SQLite database of the library for fast searches,
syncs ratings and tags with Spotify Liked Songs and playlists, and has a rofi menu for the song playing in
MPD or Spotify.

```sh
musicman                                    # the song playing in MPD or Spotify (musicman status)
musicman status --watch                     # the same, redrawn every second until q
musicman rating:4.5 grouping:Dubstep        # view songs rated 4.5 and up in a grouping
musicman edit some/dir mood=+Upbeat         # add a value to a multi value field
musicman values mood context               # the values in use, with song counts
musicman search artist "Mazzy Star" --play  # replace the MPD queue with the results
musicman sync --push                        # push Liked Songs and mapped playlists to Spotify
musicman sync --export                      # songs Spotify lacks, as Local Files to add (runbook)
musicman shuffle "Nick's Picks"             # play a playlist in a real random order (below)
musicman player next                        # skip in whichever player is active
musicman player play context:Study rating:5 # play search results (MPD, or the active Spotify)
musicman spotify repeat next                # step Spotify's repeat mode
musicman check                              # report library problems (below), changes nothing
musicman ui                                 # the management page at http://127.0.0.1:6660/ (below)
musicman --help                             # every command and switch
```

`musicman status` shows the song playing in MPD or Spotify (Spotify when both play): the player with its
volume, shuffle, and repeat, a progress bar, the song's rating, grouping, and multi value fields from the
library, the Spotify playlists that hold it (from the sync cache), where it plays from (the MPD queue
position, or the Spotify playlist, album, or artist), and its file. `musicman` without arguments shows it
while a player plays or is paused, and views the current directory otherwise. `--format json` prints the
same data for status bars; `--watch` (`-W`) redraws it every second until `q`, looking a song's tags up
again when the track changes. `status.icons: false` leaves out the Nerd Font icons.

The notify daemon (`musicman-notify`) also keeps a line for status bars in
`$XDG_RUNTIME_DIR/musicman/now-playing`, Polybar's color tags included: the player's icon, a heart when the song is
in Liked Songs, one star when its file is in the library, a pause glyph, the title and artist, and the time left.
The star is gray when unrated, a dim outline below 4.0, a bright outline at 4.0, filled at 4.5, and gold at 5.0.
`bar.colors` and `bar.maxLength` adjust it and `bar.enabled: false` turns it off; see
[the contract](docs/09-contract.md#now-playing) for the file.

`musicman player` controls whichever of MPD and the Spotify desktop app is active (the one playing,
Spotify when both play, else a paused one, else a stopped MPD), or the one named first
(`musicman player mpd next`). Without an action it prints the player's state in one line.

| Action                                          | Does                                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `toggle`, `play`, `pause`, `stop`               | playback                                                      |
| `next`, `prev`                                  | skip                                                          |
| `seek -30`, `seek +30`, `seek 90`, `seek 1:30`  | relative, or to a position                                    |
| `vol -5`, `vol +5`, `vol 40`                    | relative, or a percent                                        |
| `shuffle on\|off\|toggle`, `repeat off\|playlist\|track\|next` | the player's modes (MPD: random, repeat, single) |
| `queue [count]`                                 | the next tracks (10): MPD's queue, Spotify's (Web API)        |
| `play <terms>`, `add <terms>`                   | play (replacing the queue) or queue the songs `search` finds  |

`play` and `add` take `search` terms (`field:value`, `field value`, free text) and go to the active
player, MPD when none is; on Spotify they use the songs' Spotify ids through the Web API (Premium and a
Connect device), leaving out songs never matched to Spotify. Everything else controls Spotify through
MPRIS, so only the desktop app on this machine.

`musicman check` reports library problems without changing anything: database drift, unreadable files,
frames a rewrite would lose, custom field names that differ by case or duplicate standard frames, leftover
Spotify id frames, multi value formatting, ratings off the half step scale, garbled text, and duplicate
songs, rare context, mood, and picks values, and songs in two rating or grouping playlists. It exits 1
when it finds something. `musicman check --fix` repairs field names, fields duplicating standard frames,
leftover Spotify ids, multi value formatting, case, and artwork after one confirmation, then repairs
duplicates by rules (album over single, Rated over Unrated) with fzf to pick and confirm: Singles copies
of album songs and identical numbered copies go to a trash folder, other copies leave the library and
Spotify with their files kept, and live copies are matched to their own tracks; everything is recorded
for `musicman undo`. [docs/08-check.md](docs/08-check.md)
lists the checks and repairs.

`musicman ui` serves a management page on 127.0.0.1 (`ui.port`, 6660) until ctrl-c. It lists the Spotify
matches waiting for review, accepted in review, and rejected; picking a song shows the local file and the
Spotify track side by side with their differences marked, plays both (the file in the page, the track in
Spotify's embedded player, full length when the browser is logged in to Spotify, full length in the page
with Play here (Spotify Premium; the page becomes the Spotify Connect device "musicman ui"; logins from
before 1.47.0 need `musicman sync --login` again), or in the desktop app),
and accepts or rejects. Each action is a `ui` run in `musicman logs` that `musicman undo`, or the page's
History tab, undoes: tags and Spotify match together. It also lists, as of the last `sync`, the tracks in
mapped playlists missing from the library (with whether each is in the download manifest; Add to
downloads puts picked ones there, Download runs `pnpm download` with progress and Cancel, and Refresh
playlists fetches the playlists again first) and the songs that belong on Spotify but have no Spotify id.

The Not found tab lists the songs `sync --match` found no candidate for. Every song's panel can search
Spotify (on Not found as soon as the selection stops on a song): an empty query runs the queries of
`sync --match`, and each result shows its similarity to the song, a preview player, and Accept, which
links the song to it like accepting a review candidate.

Column headers sort the lists (Similar puts the least similar first, Length sorts by the difference of the
two lengths). Keys: `j`/`k` or the arrows move through the list, space plays the local file, `s` the Spotify track
(in the page, else in the desktop app), `a` accepts
and `r` rejects and moves on, `/` filters, Esc closes the song. The page checks every 15 seconds whether a
`sync` in a terminal changed a list (marked on its tab, with a Reload button), and shows a banner while
another musicman run that changes the library is going on, asking before each accept or reject.

Configuration: defaults in `common/config/defaultConfig.yml`, your overrides in `~/.musicmanrc.yml`.

## Documentation

| Topic                      | Document                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| Project layout and testing | [docs/01-outline.md](docs/01-outline.md)                           |
| Library database           | [docs/02-database.md](docs/02-database.md)                         |
| Spotify track ids          | [docs/03-spotify-id.md](docs/03-spotify-id.md)                     |
| Pulling from Spotify       | [docs/04-spotify-pull.md](docs/04-spotify-pull.md)                 |
| Pushing to Spotify         | [docs/05-spotify-push.md](docs/05-spotify-push.md)                 |
| Sync runbook               | [docs/06-spotify-sync-runbook.md](docs/06-spotify-sync-runbook.md) |
| rofi menu                  | [docs/07-menu.md](docs/07-menu.md)                                 |
| Library checks             | [docs/08-check.md](docs/08-check.md)                               |
| Contract for other tools   | [docs/09-contract.md](docs/09-contract.md)                         |
| Changes by version         | [CHANGELOG.md](CHANGELOG.md)                                       |
| Known issues and plans     | [TODO.md](TODO.md)                                                 |

Development: `pnpm install`, then `pnpm test` and `pnpm lint` from the root; `cli/CLAUDE.md` describes
the code.

## Spotify shuffle

Spotify's shuffle is not a uniform random permutation. Several separate behaviors add up to hearing the
same songs, often in the same order:

1. **It spreads artists out on purpose.** Since about 2014 Spotify has used a "balanced" shuffle that
   spaces tracks by the same artist or album evenly through the queue, because true random felt broken
   whenever two songs by one artist played back to back. The side effect is an order that is more
   predictable than real random.
2. **The shuffled order gets reused.** The client builds a shuffled queue once and keeps it for that
   playlist. Resuming the playlist, starting it again from the same device, or the app restoring its last
   session often brings the same order back. Turning shuffle off and on again usually forces a new one.
   This is the most likely cause of the same songs in the same order.
3. **Large playlists may only use part of the list.** Many people report that playlists of thousands of
   tracks keep drawing from the same subset; the usual explanation is that the client loads only part of
   the playlist into the shuffle pool. Spotify has never documented this, so treat it as likely but
   unconfirmed.
4. **Personalization, according to user reports.** The claim is that tracks you play, skip less, or have
   liked come up more often. Spotify has been vague about this. Smart Shuffle is a separate mode that also
   adds recommended songs: if its icon (shuffle with a sparkle) is on, you are not hearing plain shuffle.
5. **Downloaded and offline playback.** On a poor connection, shuffle may only pick from tracks already
   on the device.
6. **Some of it is perception.** Real randomness produces streaks and repeats more often than people
   expect. Exact repeats of the same order are not that, though; they point to 2.

Workarounds in the app: toggle shuffle off and on before playing, start the playlist from a random track
rather than the play button, or turn off Smart Shuffle. The most reliable fix is to randomize the actual
order of a playlist and play it with shuffle off, which avoids all of the client behavior above. That is
what `musicman shuffle` does.

### musicman shuffle

```sh
musicman shuffle liked                         # Liked Songs
musicman shuffle "Nick's Picks"                # one of your playlists, by name
musicman shuffle https://open.spotify.com/playlist/...
musicman shuffle rating:4.5 grouping:Dubstep   # library songs with a Spotify id, any view filters
musicman shuffle                               # the last source again, in a new order
musicman shuffle liked --dry-run               # count the tracks, write nothing
```

It writes the source's tracks in a uniformly random order (every order equally likely, artists not
spread apart) to one playlist of your own, `musicman shuffle` (`shuffle.playlist`), created on the first
run and rewritten on every run. Your playlists keep their order and their dates added.

Then it starts the new order with Spotify's shuffle off, through the Web API on the active Spotify Connect
device (else this computer's desktop app). It starts the tracks as a list, up to the first 1000
(`shuffle.listSize`), rather than the playlist: right after a rewrite Spotify plays a playlist's previous
order for a minute or more, while a list plays exactly as sent. When the order is longer, the notify daemon
(`musicman-notify`) continues it: as the last listed track starts it queues the next one, and when that one
starts it moves playback to the playlist at that track, which is current by then. It follows the desktop
app through MPRIS, and with the app closed (the phone alone) asks the Web API every 30 seconds, only while
a shuffle waits for that handoff. Without the daemon (or its Spotify credentials, see
`pnpm daemon:install`) playback stops after the list; the playlist keeps the whole order. To see the
handoff happen, set `shuffle.listSize` to a few tracks and shuffle. Starting playback this way needs Premium and the playback scopes (`musicman sync --login` asks for
them); without them, or with no device, it opens the playlist in the desktop app instead and warns that
the old order may play first.

- Spotify's API cannot add local files, so tracks that are local files on Spotify are left out, and so
  are library songs without a Spotify id (`musicman sync --match`); the command says how many.
- Spotify makes playlists created through its API public, whatever musicman asks for, and ignores later
  changes. Since the same playlist is reused, choose "Remove from profile" on it in the app once.
- The shuffle playlist is not a `sync.playlists` target, so `sync` never touches it.
- In `musicman menu`, `o` (reshuffle) shuffles the playlist or Liked Songs that is playing, else the last
  source again.

### Shuffle and repeat

`musicman spotify` shows Spotify's shuffle and repeat; `musicman spotify shuffle on|off|toggle` and
`musicman spotify repeat off|playlist|track|next` change them (the same as `musicman player spotify
shuffle ...`, which also works for MPD). In `musicman menu`, `u` toggles shuffle and
`r` steps repeat through off, playlist, and track. Both control the desktop app through MPRIS
(`playerctl`), so they need no Spotify permissions beyond the app itself. Smart Shuffle cannot be turned
on or off this way: neither MPRIS nor Spotify's Web API exposes it, so switch it off in the app.
