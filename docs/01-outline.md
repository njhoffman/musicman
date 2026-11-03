# Project outline

musicman manages a library of MP3 files and their tags (ratings, groupings, and custom `TXXX` fields such as
context and mood), keeps a SQLite database of them, and syncs Liked Songs and playlists with Spotify. Commands
and their options: the root `README.md` and `musicman --help`; each area has its own document in `docs/`.

Configuration: `common/config/defaultConfig.yml`, overridden by `~/.musicmanrc.yml`. `library.tags` picks the
tags musicman reads and writes from the definitions in `common/config/tags.json` and the config's `tags`.

## Layout

```
cli/                      the musicman command (package musicman-cli)
├── lib/
│   ├── cli.js            entry point: parse, run the command, archive the run
│   ├── parser/           command, target, switches, tag filters (field:value) and assignments (field=value)
│   ├── commands/         one module per command: view, edit, playlist, stats, db, sync, check, sort,
│   │                     menu, player, shuffle, spotify, status, search, logs, undo, ui, ...
│   ├── metadata/         ID3 read and write, tag definitions, filters
│   ├── db/               the library database (node:sqlite): migrations, update, search, backups
│   ├── sync/             Spotify sync: plan, push, pull, match, review, import, local files export, phone
│   ├── spotify/          Web API client, login, track matching and fields, shuffle
│   ├── beets/            the beets layout, and sorting rated songs out of Unrated
│   ├── check/            musicman check: library, frames, duplicates, playlists, fixes
│   ├── history/          the run journal and musicman undo
│   ├── menu/             the rofi menu
│   ├── player/           MPD, the Spotify desktop app (MPRIS), and Spotify Connect (Web API)
│   ├── status/           now playing and what Spotify plays it from
│   ├── notify/           song change notifications (the musicman-notify daemon)
│   ├── ui/               musicman ui, the local management page (server and public/)
│   ├── output/           table, list, stats, review, and progress output
│   ├── completion/       zsh completion
│   ├── clients/          the MPD connection
│   └── utils/            logger, runs directory, files, paths, prompts, clipboard
├── scripts/              spotDL download, notify daemon install, config check
├── share/                the rofi theme
└── test/                 integration tests, fixtures (data/), a fake MPD server
common/                   shared by the cli (package musicman-common)
├── config/               defaults, validation, tags.json
└── mpd/                  MPD protocol client
docs/                     design documents and runbooks
scripts/                  release changelog step, local build publishing (post-commit hook)
```

## Testing

`pnpm test` from the root runs the cli suite (Mocha, Chai, Sinon) and the root scripts' tests (`node
--test`). Unit specs sit next to the code as `*.spec.js`; command integration tests are in
`cli/test/integration/` with fixtures from `cli/test/data/`. Specs pass fakes in (players, Spotify clients,
child processes, temporary databases) instead of touching MPD, Spotify, or the live library.

## Conventions

- CommonJS throughout; ESM-only dependencies load with `require()` and `.default`.
- Conventional commits; every finished change gets a `CHANGELOG.md` entry and a release
  (`pnpm release`), and each commit is published as a local build (`scripts/publish-local.sh`).
- Code notes for contributors and Claude Code: `cli/CLAUDE.md`.
