# Spotify sync runbook

How to keep the library and Spotify in step with the commands that exist today, what each direction covers,
and what is still planned. Design background is in `03-spotify-id.md`. Last updated 2026-10-21.

## What syncs today

| Direction | What | How | Status |
|---|---|---|---|
| Local to Spotify | Spotify ids and fields for local songs | `sync --match`, `sync --review` | Built, first full run pending |
| Local to Spotify | Songs rated at least `sync.likedRating` (4.5) into Liked Songs | `sync --push` | Built, not yet run against Spotify |
| Local to Spotify | Songs matching a `sync.playlists` filter into that playlist | `sync --push` | Built, not yet run against Spotify |
| Local to Spotify | Songs that are not on Spotify (Local Files) | export for the desktop app | **Planned**, see below |
| Spotify to local | Tracks in Liked Songs or a mapped playlist that are not in the library | `sync --pull`, `pnpm download`, `sync --import` | Built, beets step checked; full run pending |
| Spotify to local | Playlist or Liked changes made on Spotify to songs you already have | none | **Gap**, see below; do not use `--prune` until it is closed |

Every run that changes something is archived; `musicman logs` lists runs and `musicman logs latest` shows the
last one.

## Before the first run

1. `musicman sync --login` once, in a browser; `musicman sync` shows who is logged in.
2. `musicman db --update` so the database has every song (sync reads songs from it).
3. Spotify bans apps that send too many requests, for hours (the first ban was 4.5 hours). Requests are
   paced to `spotify.requestsPerSecond` (5). When a ban is reached, `sync --match` stops and says when it
   lifts; run it again then, it continues where it stopped.

## Local to Spotify

### 1. Match songs to Spotify tracks

```sh
musicman sync --match --dry-run   # optional preview; its lookups are cached and reused by the real run
musicman sync --match             # writes TXXX.sp_* tags to the files
```

- Each song is one line: status (`MATCH`, `REVIEW`, `MISSING`, `REFRESH`, `FAILED`; `dry` in a dry run),
  source (beets, isrc, search), the Spotify track, and `+N fields ~N filled =N kept`. `-v` lists every field.
- A first full run is about 6440 songs: roughly 45 to 60 minutes. Later runs only look up new songs, recheck
  misses after 30 days, and refresh fields older than `spotify.refreshDays` (30); `--refresh` refreshes all.
- Standard tags (artist, title, year, ...) are only filled when empty, never overwritten.
- Spotify fields that are neither mapped in `spotify.fields` nor in `spotify.ignore` are reported at the end.

### 2. Review probable matches

```sh
musicman sync --review            # or --fzf to pick, --format=csv to export
musicman edit "<file>" sp_track_id=<id>   # accept one; the next sync --match fills its fields
```

### 3. Push to Liked Songs and playlists

```sh
musicman sync                     # refreshes the Spotify cache and shows the plan per target
musicman sync --push --dry-run    # what would be added
musicman sync --push              # adds after a confirmation
```

- Adds only; `--prune` (remove tracks whose song no longer belongs) is **not safe yet**, see the gap below.
- The plan's `No id` column counts songs that belong in a target but have no Spotify id: unmatched, in
  review, or not on Spotify (the Local Files case).
- The playlist add endpoints have not been verified against a real playlist yet; check the first push in the
  Spotify app.

## Spotify to local

```sh
musicman sync --pull --dry-run    # how many Spotify tracks are not in the library
musicman sync --pull              # writes manifest.json to sync.downloadDirectory
cd cli && pnpm download           # spotDL downloads the manifest; rerun to resume
musicman sync --import --dry-run  # how each download will be tagged
musicman sync --import            # tags, imports with beets into Unrated/_Singles, updates the database
```

- The manifest records, per track, the playlists it is in and the tags their filters imply, e.g.
  `grouping:IndieRock.Artists` or `context:Study`. Import writes those tags plus the Spotify fields, so the
  song already belongs in its playlists and the next push leaves it there.
- Downloads are named `<artists> - <title> [<track id>].mp3`; files without a track id or not in the
  manifest are reported and left alone. Imported tracks are marked in the manifest and skipped on reruns.
- If Spotify rate limits during import, downloads still get their id and playlist tags; `sync --match`
  fills the Spotify fields later.
- Afterwards rate the songs in `Unrated/_Singles` and run `musicman sort` to move them into `Rated`.
- spotDL downloads audio from YouTube, which is against YouTube's terms of service.

## Gap: changes made on Spotify to songs you already have

The plan compares Spotify with what the local tags say, and nothing records what was in sync last time. So
when you add a song you already have to a playlist (or like it) in the Spotify app, sync cannot tell that
apart from a song whose local tag was removed:

- `sync --push` ignores it (the track stays on Spotify, the local tags do not change).
- `sync --push --prune` removes it from the playlist again, undoing the change made on Spotify.

Plan to close it:

1. After every push and pull, store the membership of each target as the last synced state.
2. Compare three ways: in Spotify but not in the last state is a change made on Spotify; in the last state
   but no longer in the local tags is a change made locally (safe to prune).
3. Pull Spotify changes into tags where the filter can be inverted: multi value fields (`context:Study`,
   `picks:Hot`) are added or removed. Single value fields (`grouping:...`, which also decides the folder) and
   Liked Songs (no rating can be inferred) are listed for a manual decision instead of guessed.
4. Only then allow `--prune`, and only for local changes.

## Planned: local songs that are not on Spotify

The Web API cannot upload audio or add local files to playlists, so these go through the desktop app's Local
Files (from `03-spotify-id.md`; TODO items `sync --push export` and `Verify pushed local files`):

1. `sync --push` exports the songs counted under `No id` to `sync.uploadDirectory`
   (`.musicman/upload` by default), one subfolder per target playlist including Liked Songs, as hardlinks
   when on the same filesystem and copies otherwise, with a `README.md` checklist per playlist.
2. In the desktop app, add the folders as Local Files sources and drag the songs into their playlists.
3. The next `sync` reads the local tracks in each playlist (the Web API returns them with `is_local`), reports
   what is still missing, and removes completed songs from the export.

Open question to check first: whether every subfolder must be added as its own Local Files source and can be
toggled on its own. Local files only play on other devices on the same network that have the playlist
downloaded.

## When something goes wrong

- **Rate limited:** the run says when the ban lifts; rerun then. `musicman logs latest` shows what was done.
- **Interrupted (Ctrl-C, closed terminal):** results are saved every 50 songs; rerun the same command.
- **A match is wrong:** `musicman edit "<file>" sp_track_id=<right id>` and `musicman sync --match --refresh`.
- **Config errors after editing `~/.musicmanrc.yml`:** `pnpm config:check` in `cli/`. Renaming a stored
  custom field needs a rebuild: back up `musicman.sqlite`, delete it, and run `musicman db --update`.
