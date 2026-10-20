## SQLite integration

- Add the following config values with defaults: `
  - `db.path` defaults to directory of `mpd.baseDirectory` and name of `musicman.sqlite`.
  - `db.backupDirectory` defaults to directory of `mpd.baseDirectory` and subdir of `.musicman`
  - `db.backupInterval` defaults to `1 day`

### Design decisions (agreed 2026-10-20)

- **Driver**: Node's built-in `node:sqlite` (`DatabaseSync`), no native dependency.
- **Files are the source of truth**: the database is an index of the mp3 files. `db --update` reads files
  into the database; `edit` writes the file first, then updates the database row from the file it wrote.
  Tags changed outside musicman (beets, other taggers) are picked up by the next `db --update`.
- **Song identity**: path relative to `mpd.baseDirectory` is the key. The MusicBrainz track id
  (`TXXX.MusicBrainz Release Track Id`, present on nearly all rated files) is stored too, so a file moved by
  beets is re-linked to its existing row (rating history, play data) instead of becoming a new song.
  In the library 4,822 of 6,445 songs (75%) have this id; moved songs without it are removed and re-added,
  which keeps their tags (they are in the file) but resets `added_at`.
- **Incremental updates**: `db --update` skips files whose mtime and size match the stored values. A full
  first scan of ~6,400 files takes about 90s; later updates only read changed files.
- **Concurrency**: WAL journal mode so the notify daemon and the cli can read and write at the same time.
- **Migrations**: schema version stored in `PRAGMA user_version`, migrations applied in order on open.

### Schema

- `songs`: `id`, `path` (unique, relative), `mb_track_id`, `mtime`, `size`, `duration`, `rating`,
  `added_at`, `updated_at`.
- `song_tags`: `song_id`, `frame_id`, `value`. One row per populated frame, including every custom TXXX
  field (`TXXX.<description>`), not just `library.tags`, so `stats` accounting and `search` work on any
  field. Multi value fields (`multi: true`, e.g. context, mood) get one row per value so `search mood:Happy`
  is an exact match instead of a substring match.
- `tags`: tag definitions (`frame_id`, `name`, `multi`, `source` = `tags.json` or `config`). Imported from
  tags.json and the user config on startup without overwriting existing rows; a changed definition of an
  existing custom field is a fatal error (see `scratch.md`).
- `meta`: key/value for last update, last backup, and scan totals shown by `db`.

### Prerequisites

- ~~Track the test fixtures in `cli/test/data` so database tests run from a fresh clone.~~ Done.
- ~~Write progress output to stderr, only when it is a TTY, so it does not mix with command output.~~ Done.
- ~~Move tag, view, and legacy-key validation into `validator.js` with a single fatal/warning policy before
  adding the custom field definition check.~~ Done: errors are fatal and all reported together, unknown
  options are warnings.

### Database initialization

- On startup, if it doesn't exist, create a new sqlite database with the following tables:
  - songs
  - any other tables that make sense adding?
- Import the tags.json data into the database under a 'tags' table, and add all defined custom
fields (in my local config) to that table.
- take special care not to overwrite existing tags

### Database command

- Add a `db` command that without arguments shows stats about the db including last backup and sync.
  - Add a `--update` switch that will update the database from the mpd base directory. A path target
    can be used to limit the update to only that directory recursively, otherwise it will scan and
    update the entire mpd base directory.
  - Show a dynamic progress bar and percentage of the current update with other data like total
    files processed and database entries updated.
  - Leave a detailed log of all the files that were updated in the database with `debug` level,
    output summary with `info` level to log and to stdout with colors and pretty formatting.

- Update the `stats`, `view`, and `edit` command to use the database instead of the mpd base directory.
- add a 'search' command
  - specific fields can be searched by how this project uses them (rating:5.0, title:"some title") or how mpc does it
    (r(rating 5.0 title "some title")
  - if no fields are specified, take a search string as an argument for title and artist
  - if --add switch, append to playlist
  - if --play switch, create a new playlist with the results and play the new playlist right away
- Add appropriate tests and error handling for the database commands, including the `--update` switch.
