# TODO

Tracks known issues, refactoring, and planned features. Check items off (or remove them) in the commit
that resolves them. Feature specs live in `docs/`.

## Bugs

- [ ] **`pnpm lint` fails with 103 errors.** Since the `.js` rename it lints files again, but most errors are
      airbnb's `import/extensions` rejecting explicit `.js` requires. Fixed as part of the ESLint migration below.
- [ ] **Progress output goes to stdout.** `metadata/read.js` writes ` ...N files left\r` with
      `process.stdout.write`, which ends up in piped output. Write to stderr and only when it is a TTY.
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
- [ ] **Unify validation behavior.** Schema validation only warns, while tag and view checks in
      `common/config/index.js` are fatal. Pick one policy and move the tag/view/legacy checks into
      `validator.js`.
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

- [ ] **Test fixtures are not in the repo.** `test/data/` is matched by the `data` entry in `.gitignore`, so the
      sandbox MP3s, `filesMetadata.json`, and `testTags.js` exist only locally and tests cannot run from a fresh
      clone. Track them (or generate them) and narrow the ignore rule.

- [ ] Tests for `utils/logger.js` verbosity levels and padding.
- [ ] Tests for `notify-daemon` notification arguments after the refactor above.

## Features

- [ ] **Database** (`docs/02-database.md`): sqlite library database, `db --update`, `stats`/`view`/`edit`
      reading from the database, `search` command with `--add` and `--play`. Use Node's built-in
      `node:sqlite` (`DatabaseSync`), no native sqlite dependency.
- [ ] **Spotify sync** (`docs/03-spotify-id.md`): `sync`, `sync --pull`, `sync --push`, beets integration,
      playlist mapping from `grouping`.
- [ ] **Custom field definition changes** should be fatal once the database stores them (from
      `docs/scratch.md`).
- [ ] **Faster `stats`.** It reads full metadata (`mp3-duration` decodes each file to compute duration),
      about 2m10s for 951 files. Read duration from `TLEN` or the MP3 header (Xing/VBRI) and only decode when
      neither is present.
- [ ] **Smarter terminal fitting** for the table view: shrink the widest columns instead of dropping the
      rightmost ones.
- [ ] Honor `views.list.headers.visible` (currently ignored) and implement `views.table.seperators.horizontal`
      or remove it.

## Housekeeping

- [ ] Remove stale tracked files: `cli/test_output.txt`, `cli/test_output2.txt`, `cli/SESSION_SUMMARY.md`,
      `cli/CONTEXT.md` (superseded by root `CONTEXT.md`).
- [ ] Remove or update the untracked repo copy of `.musicmanrc.yml` (old config format).
- [ ] Update the stale "Current Session Context" section in `cli/CLAUDE.md`.
