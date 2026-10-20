# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
