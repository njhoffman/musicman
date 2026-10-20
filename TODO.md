# TODO

Tracks known issues, refactoring, and planned features. Check items off (`- [x]`) in the commit that
resolves them; `/todo` and `/todo-pop` (from `~/.shell`) show open/done counts and pick items. Tag an item
`(p1)` (high) or `(p3)` (low); untagged items are `p2` (normal). `(due YYYY-MM-DD)` adds a date and an
OVERDUE flag. Feature specs live in `docs/`.

## Bugs

- [x] **`pnpm lint` fails with 103 errors.** Fixed by the ESLint migration.
- [x] **`term-size` spawns `resize`**, which prints `resize: can't open terminal /dev/tty` outside a TTY
      (visible in test output). Use `process.stdout.columns` with a fallback and drop the dependency.
- [x] **Playlist paths use string replace.** `commands/playlist.js` strips `mpd.baseDirectory` with
      `String.replace`, which matches anywhere in the path. Use `path.relative`.
- [x] **`edit` asks for confirmation before checking for zero matches** (p3): zero matches now report and
      return before a prompt is built; the prompt is only created when editing several files.
- [ ] **`stats.filters` is never used.** (p3) The predefined filter sets in config ("All Songs > 4.0", ...) are
      validated but `commands/stats.js` does not compute them.
- [x] **Logging levels use different scales.** `output.verbosity` (default `info`) and `logger.file.level`
      (default `debug`) now take level names (error, warn, info, debug, trace); the unused
      `logger.stdout.level` was removed.
- [x] **Logger ignores `logger.colors`.** (p3) Terminal log lines now start with a level badge colored with
      the level's `fg`, `bg`, and `gui`; the log file is unchanged.
- [ ] **Make the notify daemon testable.** (p3) `notify-daemon.js` runs on require; split notification building
      and sending from the MPD loop so `sendNotification` can be unit tested.
- [ ] **Rename `seperators` to `separators`** (p3) in `views.table`, with a legacy-key error like the other
      migrated options.
- [ ] **Replace `bluebird`** (p3) with native promises (`Promise.map` concurrency via a small helper).
- [ ] **Replace `prompt-confirm`** (p3) (unmaintained since 2017) with `@inquirer/confirm`.
- [ ] **Vendored MPD client.** (p3) `common/mpd/MpdClient` is a local copy; evaluate a maintained client
      (e.g. `mpd-api`) instead of forking it.
- [ ] **Move existing TODO comments here and remove them from code:** (p3) combine include/exclude filters (`metadata/filter.js`), memory overflow when
      reading many files (`commands/common.js`), duration/size option for stats (`commands/stats.js`),
      zero-match handling in edit (`commands/edit.js`).

- [ ] **`library.tagId` is not used.** (p3) Decided to stay on ID3v2.3 (all sampled files, beets `id3v23: true`,
      and node-id3 all use v2.3); `year` now maps to `TYER`. `library.tagId` is set to `ID3v2.3` but nothing
      reads it. Either use it to pick v2.3/v2.4 frames for date tags or remove it. Revisit v2.4 only together
      with beets `id3v23: false` and a v2.4-capable writer.
- [ ] **Clean up duplicate TXXX fields.** `stats` shows case and spelling variants of the same field
      (`Comment`/`COMMENT`, `ALBUMARTISTS`/`ALBUM_ARTISTS`, `ARTISTS`/`Artists`) from different taggers.
      Decide which to keep and consolidate them, possibly through beets.

## Tooling

- [x] **ESLint migration:** ESLint 10 flat config (`eslint.config.js` at the root) with `@eslint/js`
      recommended, `eslint-plugin-n`, and `eslint-config-prettier`; Prettier 3 runs separately
      (`pnpm format`, `pnpm format:check`); airbnb, babel, eslint-watch, and the unused `common` ESLint
      dependencies removed.
- [ ] **Test tooling:** (p3) mocha 12, chai 6, sinon 22, sinon-chai 4, nyc to c8. Clean up
      `.mocharc.yml` (it is the full example config with placeholder values).
- [ ] **Release tooling:** (p3) `standard-version` is deprecated; switch to `commit-and-tag-version`.
- [ ] **Commit hooks:** (p3) `husky` and `commitlint` are installed but not configured (no `.husky/`, no
      commitlint config). Either set them up or remove them. Decide between gitmoji and plain conventional
      commits; both configs are installed.
- [ ] **`todos` script** (p3) points `leasot` at `.js` files and `server/`; update or remove.
- [ ] **Versioning:** (p3) root is 1.4.x, `cli` is 1.2.0, `common` is 1.0.0. Decide whether packages are versioned
      independently or with the root.

## Testing

- [ ] (p3) Tests for `utils/logger.js` verbosity levels and padding.
- [ ] (p3) Tests for `notify-daemon` notification arguments after the refactor above.

## Features

- [ ] **Smarter terminal fitting** (p3) for the table view: shrink the widest columns instead of dropping the
      rightmost ones.
- [ ] (p3) Honor `views.list.headers.visible` (currently ignored) and implement `views.table.seperators.horizontal`
      or remove it.

## Database (`docs/02-database.md`)

- [x] **Backups:** back up the database to `db.backupDirectory` every `db.backupInterval` (before writes,
      `db --backup` on demand, `db.backupCount` kept).
- [x] **`search` command:** field syntax as used here (`rating:5.0 title:"some title"`) and mpc style
      (`rating 5.0 title "some title"`); free text searches title and artist; exact matches on multi-value
      fields.
- [x] **`search --add` and `--play`:** append results to the playlist, or create a new playlist from the
      results and play it.
- [x] **Faster `search`:** a SQL prefilter narrows candidates (superset of the JavaScript filters), about
      200-500ms instead of 1-2s on 6,445 songs with identical results.
- [x] **Log file:** `logger.file.name` (default `musicman.log` in `mpd.baseDirectory`) at `logger.file.level`
      (default 5 = debug); per-file `db --update` actions go to the log only.
- [x] **Database tests and error handling** for backups, `search`, and the database-backed commands.

## Spotify sync (`docs/03-spotify-id.md`)

- [x] **Spotify credentials:** `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` (or `_URL`)
      from the environment, falling back to `spotify.*` in the config; `sync --login` saves OAuth tokens to
      `$XDG_STATE_HOME/musicman/spotify-token.json` (mode 0600).
- [x] **Sync config:** (p1) `sync.likedRating`, `sync.playlists` (filter to playlist, your 38 mappings
      moved from the doc), `sync.uploadDirectory`, `sync.downloadDirectory`, `sync.spotdlCommand`,
      `sync.beetsConfig`.
- [x] **`sync` command and cache:** (p1) refreshes the cache of Liked Songs and mapped playlists (playlists
      skipped when their snapshot is unchanged) and reports per target: songs to add, songs without a
      Spotify id, tracks to prune, and tracks to pull.
- [x] **Beets integration:** `musicman sort` (`--dry-run` to preview) finds rated songs in beets' unsorted
      folder (from its default path) with a grouping that has a beets path rule, runs `beet update -m` for
      songs beets has and `beet import -s -q -A` for the others, then updates the database.
- [x] **Spotify track ids:** (p1) `sync --match` (`--dry-run` to preview): beets ids, then ISRC, then scored
      artist/title search; confident matches written as `TXXX.spotify_track_id`, probable ones listed by
      `sync --review`, misses rechecked after 30 days.
- [ ] **Spotify audio features:** (p3) populate acousticness, danceability, energy, instrumentalness, key,
      liveness, loudness, mode, speechiness, tempo, time_signature, valence, and other Spotify tags.
- [x] **Liked Songs:** (p1) `sync --push` saves every song rated at least `sync.likedRating` that has a
      Spotify id; `--prune` removes liked tracks whose song is now rated lower.
- [x] **Grouping playlists:** (p1) `sync --push` adds songs matching each `sync.playlists` filter to its
      playlist; `--prune` removes tracks whose song no longer matches. Playlist add/remove use the
      `/items` endpoints with a `/tracks` fallback, not yet verified against a real playlist.
- [ ] **`sync --push` export:** export songs missing from Spotify to `sync.uploadDirectory`, one subfolder per
      target playlist (hardlinks when possible), with a `README.md` checklist and printed summary. Verify first
      how Spotify desktop Local Files sources handle subfolders.
- [ ] **Verify pushed local files:** on `sync`, read local tracks in the mapped playlists, report songs still
      missing, and remove completed ones from the export directory.
- [x] **`sync --pull` manifest:** writes `manifest.json` to `sync.downloadDirectory` with each Spotify-only
      track's URL, its targets, and the tags those targets' filters imply (`--dry-run` to preview).
- [ ] **spotDL download script:** download the manifest with spotDL using `{track-id}` in the output template;
      reruns skip existing files.
- [ ] **`sync --import`:** match downloads to the manifest by track id, write the Spotify id and playlist tags,
      `beet import -s -q --quiet-fallback=asis -l <log>` into `Sorted/Unrated/_Singles`, report untaggable files,
      update the database.

## Housekeeping

- [ ] (p3) Remove stale tracked files: `cli/test_output.txt`, `cli/test_output2.txt`, `cli/SESSION_SUMMARY.md`,
      `cli/CONTEXT.md` (superseded by root `CONTEXT.md`).
- [ ] (p3) Remove or update the untracked repo copy of `.musicmanrc.yml` (old config format).
- [ ] (p3) Update the stale "Current Session Context" section in `cli/CLAUDE.md`.
