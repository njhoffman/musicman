# CLAUDE.md

Guidance for Claude Code in this repository. User-facing behavior is in the root `README.md` and `docs/`;
history in `CHANGELOG.md`; open work in `TODO.md`.

## Commands

From the repo root (a pnpm workspace: `cli`, `common`):

- `pnpm test`: the cli mocha suite (`cli/.mocharc.yml`, `NODE_ENV=test`), then `node --test scripts/*.test.js`
- `pnpm lint`, `pnpm format:check` (prettier; run it on the files you touch only, some files predate it)
- `pnpm release --release-as patch|minor|major`: commit-and-tag-version; bumps `package.json`, moves the
  `CHANGELOG.md` [Unreleased] entries under the new version (`scripts/release-changelog.js`), commits, tags
- The post-commit hook runs `scripts/publish-local.sh`: every commit is built into
  `~/.local/share/musicman/builds/` and `current` points at it; the `musicman` alias runs that build, and
  the `musicman-notify` daemon is restarted on it when it runs

From `cli/`: `pnpm start` (`node lib/cli.js`), `pnpm test:coverage` (c8), `pnpm config:check`,
`pnpm download` (spotDL, `scripts/spotdl-download.js`), `pnpm daemon:install` (notify daemon service).

A single spec: `NODE_ENV=test npx mocha --no-config --require ./test/setup.js lib/x/y.spec.js` (from `cli/`;
`--no-config` drops the 20 s timeout, so slow specs may time out there but not in `pnpm test`).

## Rules

- Never run dev code against the live database (`db.path` in `~/.musicmanrc.yml`): opening it migrates the
  schema and breaks the installed build. Read it with `sqlite3 "file:...?mode=ro"`; test with temp databases.
- CommonJS only (`.js`, no `"type": "module"`); ESM-only dependencies load with `require()` and `.default`.
- Config is loaded explicitly with `loadConfig()` from `musicman-common/config` (always `~/.musicmanrc.yml`);
  nothing reads config on require, tests pass configs in.
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`), header at most 72 characters
  (commitlint), each finished change gets a CHANGELOG entry and a release.

## Layout (`cli/lib/`)

| Folder        | What it holds                                                                           |
| ------------- | --------------------------------------------------------------------------------------- |
| `cli.js`      | entry point: parse, run the command, archive the run                                    |
| `parser/`     | command, target, switches (`options/switchMap.js`), filters, assignments                |
| `commands/`   | one module per command (`view`, `edit`, `sync`, `menu`, `player`, `ui`, ...)            |
| `metadata/`   | ID3 read and write (node-id3), tag definitions, filters                                 |
| `db/`         | the library database (`node:sqlite`): migrations, update, search, backups               |
| `sync/`       | Spotify sync: plan, push, pull, match, import, local files export, phone mirror         |
| `spotify/`    | Web API client, auth, matching, track fields                                            |
| `beets/`      | the beets layout and sorting of rated songs                                             |
| `check/`      | `musicman check`: library, frames, duplicates, playlists, fixes                         |
| `history/`    | run journal and `musicman undo`                                                         |
| `menu/`       | the rofi menu (`musicman menu`)                                                         |
| `player/`     | MPD, Spotify MPRIS, and Spotify Connect (Web API) players                               |
| `status/`     | now playing and its Spotify context                                                     |
| `notify/`     | song change notifications (the `musicman-notify` daemon, `notify-daemon.js`)            |
| `ui/`         | `musicman ui`: the local management page (`server.js`, `public/`)                       |
| `output/`     | table, list, stats, and other formatters; `views.table` and `views.list` configure them |
| `completion/` | zsh completion                                                                          |
| `clients/`    | the MPD connection                                                                      |
| `utils/`      | logger, runs directory, files, paths, clipboard, prompts                                |

`common/` holds the config (`config/`: defaults, validation, `tags.json`) and the MPD protocol helpers.

## Tests

- Mocha, Chai, Sinon (`test/setup.js` puts them on global); specs sit next to the code as `*.spec.js`.
- Command integration tests in `test/integration/` use fixtures from `test/data/` and `test/fakeMpd.js`.
- Dependencies are passed in (players, clients, `spawnProcess`, `exec`, `openDb`) rather than stubbed
  with proxyquire, which only a few older specs use.
- Mock MPD, Spotify, rofi, and the file system; never the live library or a real Spotify account.
