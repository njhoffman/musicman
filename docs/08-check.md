## Library checks

`musicman check [target]` reports problems in the library and changes nothing. Without a target it checks
the whole library (`mpd.baseDirectory`); a directory inside it narrows the check to the songs there.

```sh
musicman check                         # every check, the first 10 findings of each
musicman check --only=names,duplicates # some checks (-c)
musicman check --only=multi --all      # every finding of a check (-A)
musicman check --format=json           # every finding, for scripts
```

Each check prints `ok`, or a count and its first 10 findings; the last line says how many checks found
something. The command exits 1 when any did, so it can run from cron or a hook.

| Check        | Reads    | Reports                                                                                    |
| ------------ | -------- | ------------------------------------------------------------------------------------------ |
| `drift`      | files    | files changed since the last `db --update`, songs whose file is gone, files not in the db  |
| `unreadable` | files    | files without an ID3v2 tag, not writable, or with a tag that cannot be read or walked      |
| `frames`     | files    | frames node-id3 does not understand in a tag musicman cannot copy them back into          |
| `names`      | database | custom field names that differ only by case or punctuation, the most used one suggested    |
| `standard`   | database | custom fields that duplicate a standard frame (`TXXX.Comment` for `COMM`)                  |
| `spotify-id` | database | leftover `TXXX.spotify_track_id` frames (the id now lives in `sp_track_id`)                |
| `multi`      | files    | multi value fields with empty items (`Lounge,Study,`), spaces around items, or repeats     |
| `case`       | database | values of a multi value field that differ only in case across the library                  |
| `rating`     | database | ratings off the half step scale (2.8), and rating frames that cannot be read              |
| `encoding`   | database | text that looks garbled by a wrong encoding                                                |
| `duplicates` | database | the same song in more than one file (below)                                                |

Database checks query `song_tags`, which holds every populated frame of every file, so they are as current
as the last `db --update`; `drift` shows how far behind that is. File checks read each file's tag (not its
audio) once; the whole library takes about 40 seconds.

- `frames`: when musicman writes tags it copies the frames node-id3 drops (TCMP, TSOC, ...) back into the
  new tag, but only into a plain ID3v2.3 tag; in an ID3v2.4 tag, or one with an extended header, they would
  be lost. Other files are fine and not listed.
- `encoding` looks for the replacement character, UTF-8 read as Latin-1 (`Ã©`, `â€™`), control
  characters, and halfwidth or fullwidth forms in text without Japanese, Chinese, or Korean characters.
- `duplicates` groups files with one Spotify track id, one MusicBrainz release track id, or the same artist
  and title (ignoring case, punctuation, and accents) with lengths within 2 seconds. A group found by an id
  is not listed again by name. The same recording on an album and a compilation is reported too; it may be
  intended.

Repairs (`check --fix`, recorded for `musicman undo`) are planned per check; see TODO.md.
