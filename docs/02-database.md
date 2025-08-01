## SQLite integration

- Add the following config values with defaults: `
  - `db.path` defaults to directory of `mpd.baseDirectory` and name of `musicman.sqlite`.
  - `db.backupDirectory` defaults to directory of `mpd.baseDirectory` and subdir of `.musicman`
  - `db.backupInterval` defaults to `1 day`

### Database initialization

- On startup, if it doesn't exist, create a new sqlite database with the following tables:
    - songs
- Import the tags.json data into the database under a 'tags' table, and add all defined custom
fields (in my local config) to that table.

When these fields are saved to songs and their database component, they shoul
  - id: TXXX.PrimaryGenre
    name: primary

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
- Add appropriate tests and error handling for the database commands, including the `--update` switch.
