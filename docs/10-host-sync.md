# Host sync

Status: written 2026-11-14; being built (TODO.md section 15). Built so far (2026-11-15): the audio hash
(`songs.audio_hash`, step 1) and the change log (the `changes` table, step 2); the bucket and its
credentials exist (2026-11-21). Not yet: push, pull, apply, imports through S3.

Two computers keep a full copy of the library and both play, rate, tag, review matches, and import:
**charon** (laptop, leaves the house) and **minerva** (desktop, stays home). Host sync keeps them the same.
Each host keeps its own files and its own database; what they share is a **change log** in S3, plus the
audio of songs one host imported and the other has not seen.

## Why not a shared copy of the library

- A tag edit rewrites the whole mp3, so a file mirror (rclone, `aws s3 sync`, Syncthing) can only keep one
  side's file: a rating made on charon and a mood added on minerva to the same song lose one of the two.
- Paths are not stable: a song with a rating and a grouping moves into Rated (beets), which a mirror sees as
  a delete and an add.
- The database cannot be shared or copied around: WAL mode, the notify daemon writing to it, and opening it
  with another build migrates it.
- A mirror does not know why a file changed, so it cannot merge two changes field by field.

The NAS share (`/mnt/nfs`) is not the central place either: charon is away from it, and its CIFS mount has
caused two real bugs already (mtimes stamped on close, case-insensitive names).

## What is shared

| State                                      | Where it lives today        | Shared as                       |
| ------------------------------------------ | --------------------------- | ------------------------------- |
| tags (rating, grouping, context, mood, ...) | the files' ID3 frames       | change log entries              |
| Spotify matches and review decisions        | `spotify_matches` (db only) | change log entries              |
| new songs (imports)                         | the files                   | an entry plus the audio in S3   |
| deleted songs (removed from the library)    | gone                        | change log entries              |
| file layout (Rated, groupings)              | beets, from the tags        | not shared: each host's beets files songs by the same tags |
| Spotify playlist cache, sync state          | db tables                   | not shared: each host reads Spotify |
| undo history, run reports                   | db, runs directory          | not shared: undo on one host makes new entries |

## Song identity

Paths differ between hosts and change on a move, so entries name songs by an **audio hash**: SHA-256 of the
audio data with the ID3v2 tag at the start and the ID3v1 tag at the end left out, so tag writes and moves do
not change it. Stored per song in the database (`songs.audio_hash`, filled by `db --update` for new and
changed files; hashing all 47 GB once takes a few minutes). The MusicBrainz track id (4725 of 7253 songs) and
the Spotify match (5282) do not cover every song, so they are kept in entries as hints for a song whose hash
is unknown, not used as the identity.

A re-encoded or retagged-by-another-tool file whose audio bytes changed gets a new hash: it shows up as an
unknown song in `sync --hosts --status`, and `--relink HASH FILE` points the old hash at it.

## Change log entries

One JSON object per change, written by the paths every change already goes through (the undo journal's
`journaledWrite` and `journaledMatch`, `cli/lib/history/changes.js`; imports and removed duplicates come with
step 5), so nothing new can skip it. Locally they are rows of the `changes` table, which is never pruned with
the undo history; `origin` marks a row that applied another computer's entry, so it is not pushed back:

```json
{
  "id": "charon-000123",
  "host": "charon",
  "at": "2026-11-14T22:31:05.120Z",
  "song": { "hash": "9f2c...", "mbid": "…", "spotify": "4uLU6hMCjMI75M1A2tKUQC" },
  "kind": "set",
  "field": "rating",
  "value": "4.5",
  "previous": "4"
}
```

- Entries name library fields, not ID3 frames (`rating`, not POPM with its email and play counter), so
  applying one is a `musicman edit` assignment (`rating=4.5`, `mood=+Calm`, `mood=-Sad`).
- `kind`: `set` (a single value field, `value` and `previous`, null for none), `add` / `remove` (one value
  of a multi value field: context, mood, picks), `match` (the song's `spotify_matches` decision: status,
  track id, source, reviewed, rejected ids, as JSON), `add-song` (an imported song, with `object`, the S3
  key of its audio; step 5), `delete` (step 5).
- `id`: the host and a counter of its own, so entries never collide and a host knows how far it read.
- An undo is not special: it writes the entries that put the old values back.

## S3 layout

One bucket in the project's selected Region, private, versioning on (a bad push can be rolled back):

```
musicman-sync/
  log/charon/000000123.jsonl      entries, in batches; a host writes only under its own name
  log/minerva/000000045.jsonl
  audio/9f/9f2c....mp3            imported songs by audio hash, written once, never changed
  hosts/charon.json               where the host has read up to in each other log, its build, last push
```

Nothing is ever rewritten or deleted by a push, so two hosts can never overwrite each other and there is no
locking. Costs at this size: the log is kilobytes; audio is about $1/month if the whole library ever ended
up there (S3 Standard, 47 GB), but only imports go there; transfer stays well inside the 100 GB/month free
allowance. Check the account plan first (`aws freetier get-account-plan-state`): on the free plan S3's free
tier is 5 GB.

Credentials: one IAM role or user scoped to this bucket only (`s3:GetObject`, `s3:PutObject`,
`s3:ListBucket`), profile name in config (`hostSync.profile`), so musicman never sees other credentials.

As created (2026-11-21, paid plan): bucket `musicman-sync` in us-east-2 with Block Public Access, versioning,
SSE-S3 (bucket key), and a lifecycle rule that expires noncurrent versions after 30 days (the rewritten
`hosts/<host>.json` files) and aborts multipart uploads left after 7 days. The IAM user `musicman-sync` has
one inline policy, `musicman-sync-bucket`, with exactly the three actions above; its access key is the
profile `musicman-sync` (region us-east-2) in `~/.aws/credentials`. It cannot delete objects: a bad entry
is fixed by a later one, and an old version is restored with the owner's credentials.

## Pull, apply, push

`musicman sync --hosts` (also run by the notify daemon at start and every `hostSync.interval`, 15 minutes):

1. **Pull** the other hosts' new batches (after the last id in `hosts/<me>.json`).
2. **Apply** each entry in time order through the normal edit path (tags written to the file, the database
   updated, the change recorded for undo as a run named `sync --hosts`), so beets files songs the same way on
   both hosts. `add` downloads the audio and imports it the way `sync --import` does.
3. **Push** this host's entries made since its last push, then update `hosts/<me>.json`.

Offline (charon on a plane), changes queue locally and go out on the next run; nothing blocks on S3.

### Conflicts

Both hosts changed the same thing since they last synced:

- Single value fields (rating, grouping, ...): the newest `at` wins. The losing change stays in the log and
  is listed in the run report (`musicman logs`).
- Multi value fields: adds and removes merge (a `+Upbeat` on charon and a `+Study` on minerva give both); an
  add and a remove of the same value: the newest wins.
- Matches: the newest decision wins; a song reviewed on both is listed.
- An entry for a song this host does not have (not imported yet, deleted here): kept pending and retried
  after the next `add`; `--status` lists them.

Clocks: both hosts run NTP; entries more than a minute in the future are applied but flagged.

### Spotify

`sync --push` writes Liked Songs and playlists from the library, so a host must not push before it has the
other host's changes. `sync --push` runs a host pull first when `hostSync` is configured, and refuses (with
`--force` to override) when the pull fails.

## Setting up minerva

1. Copy the library over the LAN: `rsync -a charon:Music/Sorted/ ~/Music/Sorted/` (not from S3).
2. Copy charon's database once, with both hosts on the same musicman build, so matches, review decisions and
   history come along (a database rebuilt from the files has none of them).
3. `musicman sync --hosts --init`: names the host, records the log position as "everything so far", and
   pushes nothing old.

## Audio: S3 or rsync

Decided (2026-11-14): imported audio goes to S3, so a song imported on either host reaches the other one anywhere. The
alternative, rsync when both are home, keeps nothing in AWS but leaves songs imported on the road on one host
until both are home; the `add` entry would then carry no `object` and the other host would list the song as
missing until `sync --hosts --fetch charon` copies it over the LAN. Switching later only changes step 2's
`add` handling.

## Commands and config

```
musicman sync --hosts             pull, apply, push
musicman sync --hosts --status    pending entries both ways, unknown songs, conflicts of the last run
musicman sync --hosts --init      first run on a host
musicman sync --hosts --dry-run   what a pull would change
```

```yaml
hostSync:
  name:            # this host's name in the log, default the hostname
  bucket: musicman-sync
  profile: musicman-sync
  interval: 15 minutes
  audio: s3        # or lan
```
