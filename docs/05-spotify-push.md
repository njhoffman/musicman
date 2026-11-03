# Spotify push

How `musicman sync --push` brings Liked Songs and the mapped playlists in line with the local tags: what
decides where a song belongs, what a push adds, removes, and leaves alone, and how it is undone. The
commands to run are in `06-spotify-sync-runbook.md`; matching songs to tracks is in `03-spotify-id.md`.
Last updated 2026-11-01 (exclusive groups, 1.42.0).

## Targets

A target is Liked Songs or a Spotify playlist mapped in `sync.playlists`:

```yaml
sync:
  likedRating: 4.5        # Liked Songs: songs rated at least this
  scope: 'rating:4'       # only songs matching this filter are synced at all
  playlists:
    - filter: 'rating:4.5-4.5'
      playlist: https://open.spotify.com/playlist/0deBgxaKJq70b44cgGAh5R
    - filter: 'grouping:IndieRock.Artists'
      playlist: https://open.spotify.com/playlist/25khvbDJw6mVwq4sxA6Tje
    - filter: 'grouping:IndieRock.Singles'     # several filters can map to one playlist
      playlist: https://open.spotify.com/playlist/25khvbDJw6mVwq4sxA6Tje
    - filter: 'context:Study'
      playlist: https://open.spotify.com/playlist/6hik9wlDckKrPZ9FTusxJH
```

- Filters use the view/search syntax (`field:value`, ranges for rating). A song belongs in a playlist when
  it matches any filter mapped to it (`songTargets`, `lib/sync/targets.js`).
- Songs outside `sync.scope` are marked out of scope and belong nowhere: push never adds or removes them,
  wherever they are on Spotify. Pull and match skip them too.
- `sync.ignorePlaylist` is not a target: tracks the menu's ignore button puts there are never pulled.

## The plan

Every sync refreshes the cache of each target (`spotify_playlists`, `spotify_playlist_tracks`; playlists
whose snapshot id did not change are not fetched again), then builds a plan per target (`syncPlan`,
`lib/sync/plan.js`) from the cache, the songs' targets, and what both sides agreed on at the last sync
(`spotify_synced`):

| Column | Meaning | Acted on by |
|---|---|---|
| Add | belongs by its tags, not in the target, not removed on Spotify since the last sync | `--push` |
| Conflict | would be Add, but its copies disagree within an exclusive group (below) | nothing, until resolved |
| No id | belongs but has no Spotify id (unmatched, in review, or not on Spotify) | `sync --match` |
| Prune | in the target, no copy belongs any more, and it was in sync before (a local change) | `--push --prune` |
| Rejected | a track rejected in review that no song is linked to any more | `--push` removes it |
| +Spotify | in the target, does not belong, never in sync (added on Spotify) | `--pull` (`04-spotify-pull.md`) |
| -Spotify | belongs, not in the target, in sync before (removed on Spotify) | `--pull`; push does not re-add it |
| Pull | in the target, not in the library (nor another release of a library song) | `--pull` download manifest |

- After every sync that is not a dry run, the agreed state is stored; tracks the two sides still disagree
  on keep their previous state, so a change stays a change until it is resolved.
- Several files can be linked to one track (an album copy and a compilation copy). A track belongs in a
  target when any copy does, and is pruned only when no copy does. Adds are sent once per track.
- A track in a target that is another release of a library song (the same ISRC as the song's
  `sp_isrc`, e.g. the single and the album track) counts as that song's track: it is not pulled, the
  song is not added next to it, and when the song's tags do not put it in that target it shows as
  +Spotify (its playlist tags reach the song on `--pull`). Prune removes it by its own id. Tracks
  rejected in review or in `sync.ignorePlaylist` never count as another release. The ISRCs come from
  the playlist cache; the first sync after upgrading fetches every playlist again to fill them in.

## Exclusive groups

Playlists whose filter is one `field:value` term on a single value field (rating, grouping; not context,
mood, or picks) form a group per field; a song belongs in at most one playlist of a group. The `.Artists`
and `.Singles` filters of one grouping playlist count as one member (`exclusiveGroups`).

One file can only match one playlist of a group, so a conflict always comes from several files linked to
one track that disagree, e.g. a studio file rated 5.0 and a live file matched to the same track rated 4.5.
For such a track (`conflictingTargets`):

- push adds it to none of the group's playlists the copies disagree on (the `Conflict` column, and a
  warning pointing to `check --only=exclusive`);
- other targets (Liked Songs, context, mood, and picks playlists) still get it;
- wherever it already is, it stays: it is not pruned, since a copy still belongs there.

Resolve it by giving the copies one rating or grouping, or by unlinking the copy matched to the wrong
recording (`sync --review --reject`); the next push adds it, and `--push --prune` removes it from the
playlist it no longer belongs in. `musicman check --only=exclusive` lists every song in two playlists of a
group, locally and on Spotify.

## Pushing

- Before any change, Liked Songs and every mapped playlist are fetched fresh and saved to
  `<db.backupDirectory>/spotify/<time>.json` (name, snapshot id, tracks in order with when they were added).
- Adds go 100 tracks per request to playlists (`POST /playlists/{id}/items`) and 50 to Liked Songs
  (`PUT /me/tracks`); removes likewise (`DELETE`). Each successful request is recorded in
  `spotify_changes` for the run.
- Rejected tracks are removed on every push; other tracks only with `--prune`.
- `--prune` is opt-in: without it, tracks whose tags changed are only counted. It never removes a track
  added on Spotify; those are `+Spotify` and go to pull.
- `--dry-run` prints the plan and changes nothing.

## Undo

`musicman undo <run>` reverses a push: tracks it added are removed, and tracks it removed are put back at
their old position (from the snapshot taken before the push). Verified 2026-11-01: a pruned track went back
to position 58 of 280. The tags are not touched, so the next push adds the removed adds again unless the
tags change.

## Immediate push from the menu

The rofi menu (`07-menu.md`) pushes one song's tag change right away (`pushSong`, `lib/sync/song.js`) instead
of waiting for a sync: for each target the change moved the song into or out of, the track is added or
removed, unless another copy keeps it there. The playlist is refreshed first so a track is never added
twice. The same exclusive group rule applies: a rating or grouping playlist the copies disagree on is
skipped, and the menu says so in a notification. Each press is its own run, so `musicman undo` takes back
one press.

## Not built yet

- Removing local tracks from playlists: the Web API does not take local files, so a stale local entry
  (`README.md` of `sync --export` lists them) is removed by hand.
