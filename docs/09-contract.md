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
