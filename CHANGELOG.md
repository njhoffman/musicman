# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.22.1](https://github.com/njhoffman/musicman/compare/v1.22.0...v1.22.1) (2026-10-22)


### Bug Fixes

* retry Spotify token requests and show review picks in aligned columns ([31af6e6](https://github.com/njhoffman/musicman/commit/31af6e6582d6e44cdfea4addfce302058970a685))

## [1.22.0](https://github.com/njhoffman/musicman/compare/v1.21.3...v1.22.0) (2026-10-22)


### Features

* recheck existing Spotify matches and accept or reject them in review ([ee0ff3e](https://github.com/njhoffman/musicman/commit/ee0ff3e1462b545fb34e59119544edd831c0a5ff))

### [1.21.3](https://github.com/njhoffman/musicman/compare/v1.21.2...v1.21.3) (2026-10-21)


### Bug Fixes

* send Spotify matches of another mix, edit, or version to review ([b7589d3](https://github.com/njhoffman/musicman/commit/b7589d39f91864c904d84e37b132cf240d68cf19))

### [1.21.2](https://github.com/njhoffman/musicman/compare/v1.21.1...v1.21.2) (2026-10-21)


### Bug Fixes

* reject words sync and sort do not take instead of ignoring them ([33c2d07](https://github.com/njhoffman/musicman/commit/33c2d07e4495584cf213e305703cb07141851ae2))

### [1.21.1](https://github.com/njhoffman/musicman/compare/v1.21.0...v1.21.1) (2026-10-21)


### Bug Fixes

* reject a first word that is not a command instead of viewing the library ([ca9b29a](https://github.com/njhoffman/musicman/commit/ca9b29a26578eb966fe5f7c352c6fbd432a364b2))

## [1.21.0](https://github.com/njhoffman/musicman/compare/v1.20.0...v1.21.0) (2026-10-21)


### Features

* publish a local build of every commit for the musicman alias ([8b217fa](https://github.com/njhoffman/musicman/commit/8b217facddaac3b384826920746fb8e902a4dc68))

## [1.20.0](https://github.com/njhoffman/musicman/compare/v1.19.0...v1.20.0) (2026-10-21)


### Features

* view and playlist use the whole library when no directory is given ([d851d4a](https://github.com/njhoffman/musicman/commit/d851d4a0171dc0798d04cd870603a3c417eec117))

## [1.19.0](https://github.com/njhoffman/musicman/compare/v1.18.0...v1.19.0) (2026-10-21)


### Features

* limit sync to songs matching sync.scope and add sync --backup --force ([620a11a](https://github.com/njhoffman/musicman/commit/620a11aa5269a65e5b8b5388db0ebe0a702a4e93))

## [1.18.0](https://github.com/njhoffman/musicman/compare/v1.17.0...v1.18.0) (2026-10-21)


### Features

* add sync --backup and save Spotify lists before every push ([ffe6e04](https://github.com/njhoffman/musicman/commit/ffe6e04689536bdba9e97d32731546f792a07c33))
* back up the database automatically once a week ([a319005](https://github.com/njhoffman/musicman/commit/a31900547b6eb010257b17a1d3037c7097a28407))


### Bug Fixes

* keep ID3 frames node-id3 cannot read when writing tags ([8415ecf](https://github.com/njhoffman/musicman/commit/8415ecfa314976e4175186c41b8b26841988f0f2))
* write tags to files with an empty UFID frame and cap search query length ([c1abdac](https://github.com/njhoffman/musicman/commit/c1abdac3ff9d6dfc7486c0c90d39a729175430a3))

## [1.17.0](https://github.com/njhoffman/musicman/compare/v1.16.0...v1.17.0) (2026-10-21)


### Features

* sync playlist changes made on Spotify back into tags ([1a7bf37](https://github.com/njhoffman/musicman/commit/1a7bf37bc477875ce6aca105d5a93704b42bdf11))

## [1.16.0](https://github.com/njhoffman/musicman/compare/v1.15.0...v1.16.0) (2026-10-21)


### Features

* add the spotDL download script and sync --import ([35112b0](https://github.com/njhoffman/musicman/commit/35112b09995a659629855cbc48a45a27214e5f3a))
* cache sync --match lookups in dry runs and save results per chunk ([98c9fbd](https://github.com/njhoffman/musicman/commit/98c9fbd8fbb27a1150624c7977177c3daefe9333))
* color the sync --match and db --update status lines ([faa9081](https://github.com/njhoffman/musicman/commit/faa908154c815c9f900ce8a4f8a7088fa01b45bb))
* scan the whole library recursively with stats when no target is given ([affe0bb](https://github.com/njhoffman/musicman/commit/affe0bb853aa648c4180825c09f4b5d6c6f27068))
* stop sync --match at long Spotify rate limits and add --verbose ([a071485](https://github.com/njhoffman/musicman/commit/a071485796bb8f9ddcc0b8ff89c13faea5317749))


### Bug Fixes

* archive runs stopped by a closed terminal as interrupted ([f357bc0](https://github.com/njhoffman/musicman/commit/f357bc06d033b31169da2d1c3d325c0011dce43d))
* pace the Spotify playlist refresh and push requests like the lookups ([eaed0e1](https://github.com/njhoffman/musicman/commit/eaed0e1ee843b9e23d59d0bc3a190ce37e6ff689))

## [1.15.0](https://github.com/njhoffman/musicman/compare/v1.14.0...v1.15.0) (2026-10-21)


### Features

* add --format (oneline, csv, json, html) and --fzf to list output ([afeed40](https://github.com/njhoffman/musicman/commit/afeed4083d7ab2a4185ccfb2ec67872d206d9ef3))
* add logs command to view archived runs ([6ab2b8b](https://github.com/njhoffman/musicman/commit/6ab2b8b5285a8ba88959bf2687f2d2aec28bd734))
* archive runs that change something and keep progress as a footer ([eb4646e](https://github.com/njhoffman/musicman/commit/eb4646e5fcda038b72566278ff2cdad38bd93a12))
* write Spotify fields as sp_ tags with verbose sync --match output ([698d69f](https://github.com/njhoffman/musicman/commit/698d69f9ab6cff27a406b4f6297af5007c7b0c62))

## [1.14.0](https://github.com/njhoffman/musicman/compare/v1.13.0...v1.14.0) (2026-10-20)


### Features

* add --help and --version ([6e5bb08](https://github.com/njhoffman/musicman/commit/6e5bb08f1f32852cf196478d245690009fdc517d))
* add sort command to move rated songs out of Unrated with beets ([fcff961](https://github.com/njhoffman/musicman/commit/fcff9616bf9cf2584cdccb825beab3ba9e63eee8))
* show colored level badges on terminal log lines ([0ca4439](https://github.com/njhoffman/musicman/commit/0ca443925d31057b00fe153ffe6a26d06a4de78c))
* write a download manifest with sync --pull ([e452053](https://github.com/njhoffman/musicman/commit/e4520538f9b23fb88c69b4dd813c7846d125cf1b))


### Bug Fixes

* report no matches in edit before building the confirmation prompt ([5e78470](https://github.com/njhoffman/musicman/commit/5e78470fc7e16afb6c34b02ea364879fb565f3c8))

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
