# TODO

Tracks known issues, refactoring, and planned features. Check items off (or remove them) in the commit
that resolves them. Feature specs live in `docs/`.

## Bugs

- [ ] **Stats output depends on `stats.multiFields` order and contents.** `output/stats.js` reads
      `stats[0].context`, `stats[1].mood`, `stats[2].picks`, `stats[3].genre`, `stats[4].grouping` by array
      index. With the default `multiFields: [context, mood]`, index 3 holds grouping, so `stats[3].genre` is
      undefined and `outputStat` throws ("Cannot convert undefined or null to object"). Only configs with
      exactly `[context, mood, picks]` work. Key stats by field name and render every configured multi field.
- [ ] **Config validation and config loading use different files.** `validator.js` always validates
      `~/.musicmanrc.yml`, while the loader uses a cosmiconfig search from the current directory up to home.
      Run outside home (e.g. `/mnt/music`) the user config is not loaded at all and defaults are used silently.
      Validate the file that was actually loaded, and decide whether to fall back to `~/.musicmanrc.yml`.
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
- [ ] **Logger ignores `logger.colors`.** The hex colors and `gui` styles in config are validated but never
      applied by `utils/logger.js`.

## Refactoring

- [ ] **Don't require MPD for every command.** `cli.js` always connects to MPD, so `view <dir>` fails when
      MPD is down. Connect only when no target is given or the command needs the current song.
- [ ] **Make the notify daemon testable.** `notify-daemon.js` runs on require; split notification building
      and sending from the MPD loop so `sendNotification` can be unit tested.
- [ ] **Config loading has side effects on require.** Requiring `musicman-common/config` creates
      `~/.musicmanrc.yml` if missing and reads the real home config, so tests depend on the developer's config
      (the logger requires it at import). Load config explicitly and inject it.
- [ ] **Unify validation behavior.** Schema validation only warns, while tag and view checks in
      `common/config/index.js` are fatal. Pick one policy and move the tag/view/legacy checks into
      `validator.js`.
- [ ] **Rename `seperators` to `separators`** in `views.table`, with a legacy-key error like the other
      migrated options.
- [ ] **Replace `bluebird`** with native promises (`Promise.map` concurrency via a small helper).
- [ ] **Replace `prompt-confirm`** (unmaintained since 2017) with `@inquirer/confirm`.
- [ ] **Vendored MPD client.** `common/mpd/MpdClient` is a local copy; evaluate a maintained client
      (e.g. `mpd-api`) instead of forking it.
- [ ] **Move existing TODO comments here and remove them from code:** image field transform
      (`metadata/read.js`), combine include/exclude filters (`metadata/filter.js`), memory overflow when
      reading many files (`commands/common.js`), duration/size option for stats (`commands/stats.js`),
      zero-match handling in edit (`commands/edit.js`).

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

- [ ] Integration tests for `stats` covering different `multiFields` configs (would have caught the stats bug).
- [ ] Tests for `utils/logger.js` verbosity levels and padding.
- [ ] Tests for `notify-daemon` notification arguments after the refactor above.

## Features

- [ ] **Database** (`docs/02-database.md`): sqlite library database, `db --update`, `stats`/`view`/`edit`
      reading from the database, `search` command with `--add` and `--play`. Decide on the driver first:
      Node 24's built-in `node:sqlite` avoids native builds; `sqlite3` is installed but unused.
- [ ] **Spotify sync** (`docs/03-spotify-id.md`): `sync`, `sync --pull`, `sync --push`, beets integration,
      playlist mapping from `grouping`.
- [ ] **Custom field definition changes** should be fatal once the database stores them (from
      `docs/scratch.md`).
- [ ] **Smarter terminal fitting** for the table view: shrink the widest columns instead of dropping the
      rightmost ones.
- [ ] Honor `views.list.headers.visible` (currently ignored) and implement `views.table.seperators.horizontal`
      or remove it.

## Housekeeping

- [ ] Remove stale tracked files: `cli/test_output.txt`, `cli/test_output2.txt`, `cli/SESSION_SUMMARY.md`,
      `cli/CONTEXT.md` (superseded by root `CONTEXT.md`).
- [ ] Remove or update the untracked repo copy of `.musicmanrc.yml` (old config format).
- [ ] Update the stale "Current Session Context" section in `cli/CLAUDE.md`.
