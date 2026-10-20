# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.13.0](https://github.com/njhoffman/musicman/compare/v1.12.0...v1.13.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* numeric output.verbosity and logger.file.level values are
no longer accepted; use a level name.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Bug Fixes

* use log level names for output.verbosity and logger.file.level ([f85c3d6](https://github.com/njhoffman/musicman/commit/f85c3d661fdbf70bdda10322995c0c07a7a898cf))
* use process.stdout.columns instead of term-size ([6cc0c5a](https://github.com/njhoffman/musicman/commit/6cc0c5a0acc5756f8cfe3043ac2f9b565df7e12d))
* write playlist paths relative to the MPD music directory ([26525ab](https://github.com/njhoffman/musicman/commit/26525ab53f0e2c5661c2866bb384bf3af6649a9c))

## [1.12.0](https://github.com/njhoffman/musicman/compare/v1.11.0...v1.12.0) (2026-10-20)


### Features

* add sync config, Spotify tables, and beets Spotify id reader ([465e1f9](https://github.com/njhoffman/musicman/commit/465e1f95183092a7281a0c04236012e759764afc))
* find Spotify track ids for songs with sync --match ([a5af6eb](https://github.com/njhoffman/musicman/commit/a5af6ebd3fd7a9675e012c39a20601a7d01ebdf4))
* push Liked Songs and playlist changes with sync --push ([133926e](https://github.com/njhoffman/musicman/commit/133926ee9d7fef39126826d2746d77580b1b2d81))
* refresh the Spotify playlist cache and report the sync plan ([781cfac](https://github.com/njhoffman/musicman/commit/781cfacb2d3ed9cb7473350067e8e8ffe330a775))


### Bug Fixes

* keep a successful Spotify login when the user lookup fails ([2e5273e](https://github.com/njhoffman/musicman/commit/2e5273ef89bbfa2571b20b5ecd73b82556146e65))

## [1.11.0](https://github.com/njhoffman/musicman/compare/v1.10.0...v1.11.0) (2026-10-20)


### Features

* add Spotify login and API client for sync ([62e7040](https://github.com/njhoffman/musicman/commit/62e7040aa953dcd092795a164365a2b166ad4074))

## [1.10.0](https://github.com/njhoffman/musicman/compare/v1.9.0...v1.10.0) (2026-10-20)


### Features

* write log messages to a log file ([060aed7](https://github.com/njhoffman/musicman/commit/060aed7553fb6fad6c63188c3aad803a9ab07741))


### Bug Fixes

* match songs without a multi value field for empty filters ([8dc192e](https://github.com/njhoffman/musicman/commit/8dc192e0a60aa16a7921d904151916d10af14d37))

## [1.9.0](https://github.com/njhoffman/musicman/compare/v1.8.0...v1.9.0) (2026-10-20)


### Features

* add search command with --add and --play ([f7b2d67](https://github.com/njhoffman/musicman/commit/f7b2d679baa3965956c269b0426b0be17be8155a))
* back up the library database before writes and with db --backup ([dc4a945](https://github.com/njhoffman/musicman/commit/dc4a945b2f8674790b3a5269ccdb3efab30f2254))


### Bug Fixes

* escape backslashes in MPD arguments and add command lists ([a6a22d5](https://github.com/njhoffman/musicman/commit/a6a22d5e990afc9f697fed9d6432282b82d4162a))

## [1.8.0](https://github.com/njhoffman/musicman/compare/v1.7.0...v1.8.0) (2026-10-20)


### Features

* read stats, view, and edit metadata from the library database ([1022428](https://github.com/njhoffman/musicman/commit/1022428e7ef0476ff0b09b5d733602c1b0b5b101))


### Bug Fixes

* stop truncating piped output on large results ([7b55b51](https://github.com/njhoffman/musicman/commit/7b55b51c5fa1d536e46c7391ab010b88f8c20fea))

## [1.7.0](https://github.com/njhoffman/musicman/compare/v1.6.1...v1.7.0) (2026-10-20)


### Features

* add database config with defaults in the mpd base directory ([cab654e](https://github.com/njhoffman/musicman/commit/cab654e4f3dc9f034b387f264b5bca9b4062a408))
* add sqlite library database with db and db --update commands ([487a9cb](https://github.com/njhoffman/musicman/commit/487a9cb8926e35382af3c51c7d9205b3482a480f))


### Bug Fixes

* parse playlist write switch and long form switches ([d7ef1da](https://github.com/njhoffman/musicman/commit/d7ef1da6490d92ade52add569249693fd069dd6b))
* reject when reading duration or size fails in full metadata reads ([7a69888](https://github.com/njhoffman/musicman/commit/7a69888519e4abec2ca6ec9e4a096dd930980dd7))

### [1.6.1](https://github.com/njhoffman/musicman/compare/v1.6.0...v1.6.1) (2026-10-20)


### Bug Fixes

* write file reading progress to stderr only in a terminal ([33a708e](https://github.com/njhoffman/musicman/commit/33a708e479e764d2ca736649668856b4b2b2218a))

## [1.6.0](https://github.com/njhoffman/musicman/compare/v1.5.0...v1.6.0) (2026-10-20)


### Features

* add populated tag counts to stats command ([017a976](https://github.com/njhoffman/musicman/commit/017a9762cec8a86f9fca36bb925f1e1451fc8b81))


### Bug Fixes

* continue without current song when MPD is not running ([36635a8](https://github.com/njhoffman/musicman/commit/36635a8a0ea7038771b0497e05a3825d1890ef04))
* map year to ID3v2.3 TYER frame ([2fd218a](https://github.com/njhoffman/musicman/commit/2fd218a1673b0bc136e2b029c419426e8d3f1ebc))
* render stats for configured multi fields instead of fixed indexes ([23f03a1](https://github.com/njhoffman/musicman/commit/23f03a1b1a6a7bbc8c33d4529287fd63e97a1fe0))

## [1.5.0](https://github.com/njhoffman/musicman/compare/v1.4.1...v1.5.0) (2026-10-20)


### Bug Fixes

* run notify daemon as systemd user service instead of forever ([45dcd3d](https://github.com/njhoffman/musicman/commit/45dcd3d6332226e9b9d71b64804a3037ac0247d5))

### [1.4.1](https://github.com/njhoffman/musicman/compare/v1.4.0...v1.4.1) (2026-10-20)


### Bug Fixes

* render output columns with cli-table3 instead of columnify fork ([9ce771b](https://github.com/njhoffman/musicman/commit/9ce771b3c3e620ba696e11ea57e34d6c03e861de))

## [1.4.0](https://github.com/njhoffman/musicman/compare/v1.3.0...v1.4.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* tags no longer controls which metadata is read or written,
only tags listed in library.tags are. library.tags only supports text (T***)
and custom (TXXX.*) frames.
* output.table, output.vertical, and tags[].tableOrder are
no longer supported; use views.table and views.list instead.

### Features

* configure views per output format ([3d26072](https://github.com/njhoffman/musicman/commit/3d26072fbedfed655cd5c95148507d7bcd7ddc80))
* read and write metadata using library.tags ([2b1c1ff](https://github.com/njhoffman/musicman/commit/2b1c1ffdce2f5fb319a4a9443c9c1e98838b392a))

## [1.3.0](https://github.com/njhoffman/musicman/compare/v1.2.0...v1.3.0) (2026-10-20)


### Features

* Add comprehensive configuration management system ([541ea2c](https://github.com/njhoffman/musicman/commit/541ea2c788796c029f95b8bc9d6e1c3ef1a26936))
* Add comprehensive configuration validation and library management ([0e60fd8](https://github.com/njhoffman/musicman/commit/0e60fd8a35a591388338409fd54967e38fe46713))


### Bug Fixes

* Resolve all failing unit tests ([4ffe12f](https://github.com/njhoffman/musicman/commit/4ffe12f8eef97d30084869432fa013e3ab674181))

## [1.1.0](https://github.com/njhoffman/musicman/compare/v1.0.24...v1.1.0) (2025-01-27)

### Features

* **dependencies**: update all CLI and root dependencies to latest patch/minor versions
* **docs**: add CLAUDE.md for AI assistance and update project outline with changelog policy

### Bug Fixes

* **security**: address security vulnerabilities by updating outdated dependencies

### [1.0.6](https://github.com/njhoffman/musicman/compare/v1.0.5...v1.0.6) (2020-01-24)

### [1.0.5](https://github.com/njhoffman/musicman/compare/v1.0.4...v1.0.5) (2020-01-23)

### [1.0.4](https://github.com/njhoffman/musicman/compare/v1.0.3...v1.0.4) (2020-01-23)
