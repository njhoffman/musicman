# TODO

Tracks known issues, refactoring, and planned features. Check items off (or remove them) in the commit
that resolves them. Feature specs live in `docs/`.

## Bugs

- [ ] **`pnpm lint` fails with 103 errors.** Since the `.js` rename it lints files again, but most errors are
      airbnb's `import/extensions` rejecting explicit `.js` requires. Fixed as part of the ESLint migration below.
- [ ] **`term-size` spawns `resize`**, which prints `resize: can't open terminal /dev/tty` outside a TTY
      (visible in test output). Use `process.stdout.columns` with a fallback and drop the dependency.
- [ ] **Playlist paths use string replace.** `commands/playlist.js` strips `mpd.baseDirectory` with
      `String.replace`, which matches anywhere in the path. Use `path.relative`.
- [ ] **`edit` asks for confirmation before checking for zero matches**, and constructs the prompt even when
      it is not shown (`commands/edit.js`).
- [ ] **`stats.filters` is never used.** The predefined filter sets in config ("All Songs > 4.0", ...) are
      validated but `commands/stats.js` does not compute them.
- [ ] **Logger ignores `logger.colors`.** The hex colors and `gui` styles in config are validated but never
      applied by `utils/logger.js`.

## Refactoring

- [ ] **Make the notify daemon testable.** `notify-daemon.js` runs on require; split notification building
      and sending from the MPD loop so `sendNotification` can be unit tested.
- [ ] **Rename `seperators` to `separators`** in `views.table`, with a legacy-key error like the other
      migrated options.
- [ ] **Replace `bluebird`** with native promises (`Promise.map` concurrency via a small helper).
- [ ] **Replace `prompt-confirm`** (unmaintained since 2017) with `@inquirer/confirm`.
- [ ] **Vendored MPD client.** `common/mpd/MpdClient` is a local copy; evaluate a maintained client
      (e.g. `mpd-api`) instead of forking it.
- [ ] **Move existing TODO comments here and remove them from code:** combine include/exclude filters (`metadata/filter.js`), memory overflow when
      reading many files (`commands/common.js`), duration/size option for stats (`commands/stats.js`),
      zero-match handling in edit (`commands/edit.js`).

- [ ] **`library.tagId` is not used.** Decided to stay on ID3v2.3 (all sampled files, beets `id3v23: true`,
      and node-id3 all use v2.3); `year` now maps to `TYER`. `library.tagId` is set to `ID3v2.3` but nothing
      reads it. Either use it to pick v2.3/v2.4 frames for date tags or remove it. Revisit v2.4 only together
      with beets `id3v23: false` and a v2.4-capable writer.
- [ ] **Clean up duplicate TXXX fields.** `stats` shows case and spelling variants of the same field
      (`Comment`/`COMMENT`, `ALBUMARTISTS`/`ALBUM_ARTISTS`, `ARTISTS`/`Artists`) from different taggers.
      Decide which to keep and consolidate them, possibly through beets.

## Tooling

- [ ] **ESLint migration:** ESLint 7 to 9/10 flat config. `eslint-config-airbnb-base` does not support flat
      config; replace with `@eslint/js` recommended, `eslint-plugin-n`, and `eslint-config-prettier`. Allow
      explicit `.js` extensions in requires. Drop `eslint-watch`, `babel-eslint`, and `eslint-plugin-babel`; remove the unused ESLint
      devDependencies from `common`.
- [ ] **Test tooling:** mocha 12, chai 6, sinon 22, sinon-chai 4, prettier 3, nyc to c8. Clean up
      `.mocharc.yml` (it is the full example config with placeholder values).
- [ ] **Release tooling:** `standard-version` is deprecated; switch to `commit-and-tag-version`.
- [ ] **Commit hooks:** `husky` and `commitlint` are installed but not configured (no `.husky/`, no
      commitlint config). Either set them up or remove them. Decide between gitmoji and plain conventional
      commits; both configs are installed.
- [ ] **`todos` script** points `leasot` at `.js` files and `server/`; update or remove.
- [ ] **Versioning:** root is 1.4.x, `cli` is 1.2.0, `common` is 1.0.0. Decide whether packages are versioned
      independently or with the root.

## Testing

- [ ] Tests for `utils/logger.js` verbosity levels and padding.
- [ ] Tests for `notify-daemon` notification arguments after the refactor above.

## Features

- [ ] **Smarter terminal fitting** for the table view: shrink the widest columns instead of dropping the
      rightmost ones.
- [ ] Honor `views.list.headers.visible` (currently ignored) and implement `views.table.seperators.horizontal`
      or remove it.

## Database (`docs/02-database.md`)

- [ ] **Database config:** `db.path` (`musicman.sqlite` in the directory of `mpd.baseDirectory`),
      `db.backupDirectory` (`.musicman` subdirectory), `db.backupInterval` (1 day), with defaults and validation.
- [ ] **Schema and migrations:** `songs`, `song_tags`, `tags`, `meta` tables as designed in the doc; schema
      version in `PRAGMA user_version` with ordered migrations; WAL journal mode.
- [ ] **Tag definitions import:** load tags.json and the config custom fields into `tags` on startup without
      overwriting existing rows.
- [ ] **Custom field definition changes are fatal:** a changed definition of a stored custom field stops the
      program (from `docs/scratch.md`).
- [ ] **Backups:** back up the database to `db.backupDirectory` every `db.backupInterval`.
- [ ] **`db` command:** show database stats, last backup, and last update.
- [ ] **`db --update`:** scan `mpd.baseDirectory` (or a target path, recursively), skip files with unchanged
      mtime and size, re-link moved files by MusicBrainz track id; progress bar with percentage, files
      processed, and entries updated; per-file `debug` log and colored `info` summary.
- [ ] **Use the database in `stats`, `view`, and `edit`:** `edit` writes the file, then updates the row from
      the written file.
- [ ] **`search` command:** field syntax as used here (`rating:5.0 title:"some title"`) and mpc style
      (`rating 5.0 title "some title"`); free text searches title and artist; exact matches on multi-value
      fields.
- [ ] **`search --add` and `--play`:** append results to the playlist, or create a new playlist from the
      results and play it.
- [ ] **Database tests and error handling,** including `db --update`.

## Spotify sync (`docs/03-spotify-id.md`)

- [ ] **Open question, uploading:** the Spotify Web API cannot upload audio; local files only reach Spotify
      through the desktop app and cannot be added to playlists through the API. Decide what "push" means for
      songs not on Spotify (e.g. report them only).
- [ ] **Open question, downloading:** the Spotify API does not provide audio downloads (DRM); tools like spotDL
      fetch audio from YouTube instead, with their own terms of service concerns. Decide the source for `--pull`.
- [ ] **Spotify API authentication:** OAuth app credentials and token storage for playlist read/write.
- [ ] **`sync` command and cache:** refresh a local cache of the mapped Spotify playlists and report how many
      songs would be pulled and pushed.
- [ ] **Beets integration:** read paths from `~/.config/beets/config.yaml` and wrap the beets workflow
      (`Sorted/Unrated` to `Sorted/Rated` after rating and assigning a `grouping`).
- [ ] **Spotify track ids:** use ids from the beets spotify plugin for `Rated` songs, look up the ones it
      missed, and mark songs that are still unmatched.
- [ ] **Spotify audio features:** populate acousticness, danceability, energy, instrumentalness, key,
      liveness, loudness, mode, speechiness, tempo, time_signature, valence, and other Spotify tags.
- [ ] **Liked Songs:** add every local song rated 4.5 or higher to Liked Songs.
- [ ] **Grouping playlists:** sync songs to the Spotify playlists mapped from `grouping` values in the doc.
- [ ] **`sync --pull`:** confirm the count, download Spotify-only songs with a progress bar that can be
      cancelled and resumed, tag them with available and playlist tags, and `beet import --singletons` them
      into `Sorted/Unrated/_Singles`.
- [ ] **`sync --push`:** confirm upload and per-playlist counts, then push with a progress bar that can be
      cancelled and resumed, listing each song uploaded or added to a playlist.

## Housekeeping

- [ ] Remove stale tracked files: `cli/test_output.txt`, `cli/test_output2.txt`, `cli/SESSION_SUMMARY.md`,
      `cli/CONTEXT.md` (superseded by root `CONTEXT.md`).
- [ ] Remove or update the untracked repo copy of `.musicmanrc.yml` (old config format).
- [ ] Update the stale "Current Session Context" section in `cli/CLAUDE.md`.
