# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
