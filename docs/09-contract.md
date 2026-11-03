## Contract for other programs

What musicman keeps stable for programs that build on it without reading `~/.musicmanrc.yml` or its internal
tables. The first user is [sleeve](https://github.com/njhoffman/sleeve) (synced lyrics), which finds the
library file for the track Spotify plays so it can use the file's own lyrics and measured length.

Changing anything below is a breaking change for those programs: add fields and columns freely, but remove
or change one only with a new `version` (paths.json) or a new view name, and say so in the CHANGELOG.

### paths.json

`$XDG_STATE_HOME/musicman/paths.json` (`~/.local/state/musicman/paths.json` without `XDG_STATE_HOME`),
written by the cli and the notify daemon each time they load the config, only when something changed, and
replaced atomically (`cli/lib/utils/paths.js`).

```json
{
  "version": 1,
  "mpd": { "host": "localhost", "port": 6600, "baseDirectory": "/home/nicholas/Music/Sorted" },
  "db": { "path": "/home/nicholas/Music/Sorted/musicman.sqlite" }
}
```

| Field               | Meaning                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `version`           | 1; raised only when a field is removed or changes meaning                            |
| `mpd.host`, `.port` | MPD as musicman reaches it                                                           |
| `mpd.baseDirectory` | the library and MPD's music directory, absolute; MPD's file paths are relative to it |
| `db.path`           | the library database, absolute, or `null` when there is no library                   |

### spotify_track_files

A view in the library database (schema 10): the library files tagged with a Spotify track id
(`TXXX:sp_track_id`). Open the database read-only (`node:sqlite` `{ readOnly: true }`); musicman writes it in
WAL mode, so readers never block it.

| Column     | Type    | Meaning                                                                           |
| ---------- | ------- | --------------------------------------------------------------------------------- |
| `track_id` | TEXT    | the Spotify track id                                                              |
| `path`     | TEXT    | the file, relative to `mpd.baseDirectory`                                         |
| `duration` | REAL    | the audio's length in seconds, measured when the library was scanned; may be null |
| `excluded` | INTEGER | 1 for a duplicate copy kept on disk but out of the library (`musicman check`)     |

Several files can share a track id (duplicates); prefer `excluded = 0`:

```sql
SELECT path, duration FROM spotify_track_files WHERE track_id = ? ORDER BY excluded, path LIMIT 1
```

A database older than schema 10 has no view; readers should treat that as "no library" and suggest updating
musicman, not fall back to the tables, which may change.

### musicman values

`musicman values [field ...] --format json` prints the values of library fields with the number of songs that
have each, from the library database (no file scan; about a second). Without fields it lists `menu.tagFields`.
The second user is [fzx](https://github.com/njhoffman/fzx), whose music module offers the values in its tag
editor before writing them with `musicman edit`.

```json
{
  "mood": [
    { "value": "Mellow", "count": 960 },
    { "value": "Upbeat", "count": 324 }
  ]
}
```

- Keys are the fields' names as `library.tags` spells them (a field given as `Mood` is listed as `mood`), in the
  order given.
- Each list is most used first, then by value. Comma-joined values count as their parts, once per song.
- An unknown field is an error (exit status 1, nothing on stdout).

### Lyrics in the library's tags

sleeve writes synced lyrics into the library's mp3 files; musicman writes the other frames of the same tags.
Each keeps to its own frames, so neither undoes the other.

What musicman keeps:

- It never sets, clears or edits `USLT` or `SYLT` on its own. Its tag writes (`cli/lib/metadata/write.js`,
  node-id3 0.2) rewrite the whole tag but carry both frames over as they were: node-id3 parses them, holding one
  `USLT` and any number of `SYLT`.
- Two exceptions, both leaving lyrics that are there alone: `check --fix` moves a custom lyrics field into an
  empty `USLT` (never over one with text), and `check --duplicates` keeps the kept copy's tag, so the lyrics of
  the copies it takes out go with them.
- It notices a file sleeve changed by its mtime and size, like any other change, and reads it again on the next
  `db --update`; the `USLT` text lands in its database with the rest.

What sleeve keeps:

- It writes `USLT` and `SYLT` only, and changes no other frame, byte for byte, nor the tag's version.
- One `USLT` per file: it replaces the one there rather than adding a second, which a node-id3 rewrite would drop
  (node-id3 keeps a repeated frame only from an ID3v2.3 tag). `SYLT` frames may be several (one per language or
  content type).
- Synced lyrics it finds replace unsynced text in `USLT` (beets' lyrics plugin fills it with plain lyrics on import,
  `sync.importLyrics`) and an empty `USLT` (most of the library's). A `USLT` already holding synced lyrics (LRC
  text) is not replaced unless asked (`--force`), and no text is replaced by unsynced lyrics.
- It writes a file in place only if its mtime and size are what they were when sleeve read it, through a temporary
  file renamed over it, so a musicman write in between is never lost, only retried. It never touches the mtime
  afterwards: musicman needs the change to see it.
- It reads musicman's database only as the sections above allow, and never writes it.

Outside both: `beet write` and `beet modify` write the lyrics beets holds in its own library back into the
file, over what sleeve wrote. musicman runs neither on library files.
