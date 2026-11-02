# Spotify pull

How changes made on Spotify reach the library: tag changes for songs you already have, and downloading and
importing tracks you do not have. The commands to run are in `06-spotify-sync-runbook.md`; the plan columns
are explained in `05-spotify-push.md`. Last updated 2026-11-01.

## Two kinds of pull

| On Spotify | In the library | Plan column | What `sync --pull` does |
|---|---|---|---|
| added to a target, never in sync | yes | `+Spotify` | adds the playlist's tag, or lists it to decide |
| removed from a target, in sync before | yes | `-Spotify` | removes the playlist's tag, or lists it to decide |
| in a target | no | `Pull` | writes the download manifest |

Songs outside `sync.scope` are left alone in both directions, and tracks in `sync.ignorePlaylist` (the
menu's ignore button) are never pulled.

## Tag changes for songs you have

The three-way comparison (Spotify, the local tags, and `spotify_synced`, what both agreed on at the last
sync) tells a change made on Spotify from one made locally; see the table in `05-spotify-push.md`.

- A playlist whose filter is one value of a multi value field (`context:Study`, `picks:Hot`) can be inverted
  (`filterTag`, `lib/sync/membership.js`): a track added there gets the value, one removed loses it. These
  are the `TAG` lines, applied after one confirmation.
- Liked Songs (no rating can be inferred from it) and rating or grouping playlists (grouping also decides the
  folder) cannot; they are `DECIDE` lines. Change the rating or grouping with `musicman edit`, or undo the
  change on Spotify. They stay listed, and push neither re-adds nor prunes them, until the two sides agree.
- The first sync has no stored state, so everything on Spotify but not in the tags counts as added on
  Spotify: read the `--dry-run` output before applying it.

## Tracks you do not have

```
sync --pull            -> <sync.downloadDirectory>/manifest.json
pnpm download          -> spotDL downloads the manifest (cli/scripts/spotdl-download.js)
sync --import          -> tags the downloads, imports them with beets, updates the database
```

### Manifest (`lib/sync/pull.js`)

One entry per track in any target's `Pull` list: its Spotify URL, the targets it is in, and the tags those
targets' filters imply (e.g. `grouping:IndieRock.Artists`, `context:Study`, and the rating of an exact
rating filter like `rating:4.5-4.5`; several playlists' multi values are combined). Imported tracks are in
the library, so the next `--pull` leaves them out.

### Download (`pnpm download`)

spotDL (`sync.spotdlCommand`) downloads each manifest track to `sync.downloadDirectory` as
`<artists> - <title> [<track id>].mp3`, 20 tracks per spotDL run; rerunning resumes. `--limit N` downloads
only the first N pending tracks (for a trial), `--dry-run` lists them. spotDL takes the audio from YouTube, which is
against YouTube's terms of service.

### Import (`lib/sync/import.js`)

- A download's track id comes from its file name, or from the WOAS frame (the Spotify URL spotDL writes).
  Files without one, or whose track is not in the manifest, are reported and left alone.
- Each file gets the Spotify fields (`spotify.fields`), standard tags it has no value for, and the tags of
  its manifest playlists, so the song already belongs where it was on Spotify and the next push leaves it
  there. Album fields are left out (downloads are singletons); `sync --match` adds them once the song is
  sorted into an album folder.
- When Spotify rate limits the track lookups, files still get their id and playlist tags; `sync --match`
  fills the Spotify fields later.
- A grouping from the manifest (a track in a grouping playlist) is written to `TXXX.playlist_grouping`, not
  TIT1. beets' path rules file a song by its grouping alone, so a grouping in TIT1 would put the unrated
  download straight under `Rated/`; held back, every download lands in `Unrated/_Singles`. (On 2026-11-01,
  347 of 1281 manifest tracks had a grouping, all `.Singles`, and none had a rating.)
- beets (`sync.beetsConfig`) imports them as singletons, as is (`import -s -q -A`): the tags already
  describe the manifest's exact track, while autotagging (tried on 2026-11-01) picked other Spotify releases
  of a song and wrote their ids into the MusicBrainz fields. The database is updated and each imported
  track is marked `importedAt` in the manifest, so reruns skip it.
- The summary counts downloads tagged and imported, grouping hints, ratings, and playlist tags given,
  files beets skipped, files not in the manifest, the database changes, and manifest tracks left.
- Afterwards rate the songs and run `musicman sort`: a rated song in `Unrated` moves to `Rated` when it has
  a grouping beets has a path rule for, its own TIT1 or else the `playlist_grouping` hint, which sort writes
  to TIT1 (and removes) before beets moves the song. Songs without either need a grouping
  (`musicman edit grouping=...`) first.
- `edit` and the menu do the same as soon as a change gives an `Unrated` song its rating and grouping (or
  hint): beets moves it right away and the new path is shown. `musicman sort` stays the batch catch-up,
  and lists what is still waiting in `Unrated` and why (`needs rating (hint: Rap-R&B.Singles)`; the first
  10, `--all` for every one).
- `--dry-run` shows how each download would be tagged, writes nothing, and does not run beets.

## Status

- Tag pull: built and run (2026-10-28 onward).
- Download and import: built and tested with fixtures; the beets step was checked on its own. The whole
  pipeline (`--pull`, download, `--import`) has not yet run end to end on a real manifest. On 2026-11-01 the
  plan listed 2674 tracks to pull.
