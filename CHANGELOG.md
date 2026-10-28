# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `--include=<fields>`, `--exclude=<fields>` and `--write=<name>` work like `-i`, `-x` and `-w`; before, the
  `=` form was not read as a switch. `--help` shows their value.

## [1.27.0] - 2026-10-27

### Added

- `sync --backup` shows progress while it lists the library and the backup and while it compares them, and
  measures the copy progress in MB, so its rate and ETA follow the bytes copied.

### Fixed

- A Spotify match whose title has another number (`17 Ghosts II` and `16 Ghosts II`) costs 10 points per
  differing number, so it falls below an auto-accept threshold of 95; years such as "Remastered 2009" and
  leading zeros do not count.

## [1.26.1] - 2026-10-27

### Changed

- The `sync --backup` summary is a table: per action (copy, update, rename, hold, move) its count, size, and
  what it means, counts right aligned, zeros dimmed, and the actions with files in their list color. The file
  lists show each file's size.

## [1.26.0] - 2026-10-27

### Added

- `sync --push` shows progress bars while it saves the Spotify snapshot and while it adds and removes tracks,
  then a table of tracks added and removed per playlist with a total. `--verbose` also lists every song added
  or removed.

### Fixed

- The sync plan table header is no longer shifted right of its columns: the log badge now goes on a
  "Sync plan" title line above the table.

## [1.25.1] - 2026-10-27

### Fixed

- `sync --backup` to a case-insensitive share (SMB) no longer moves files aside when a library folder or file
  differs from its backup copy only in capitalization (`lil kiiwi (Deluxe)` and `(deluxe)`): the backup copy is
  renamed to the library's capitalization instead. Before, each run copied those files into the existing folder
  and then moved them into `.musicman-removed`, so they went missing from the backup every other run.
- The warning about copies that did not keep their modified time no longer names a file that changed while
  it was being copied, such as `musicman.log` written by the backup run itself.

## [1.25.0] - 2026-10-26

### Changed

- `sync --match` lists the matches at least `sync.autoAcceptPercent` similar, new ones and ones waiting in
  review from earlier runs, and accepts them after asking: all of them, or all but the ones you pick to leave
  out with fzf, which stay in review. They are no longer accepted without being shown.
- The `sync --match` summary is aligned: counts right aligned with notes after them, zeros dimmed, and the
  counts waiting on a decision (to auto-accept, to review) highlighted. Recently checked songs are split into
  waiting for review and not found.

## [1.24.4] - 2026-10-26

### Fixed

- `sync --backup` to an SMB (CIFS) share no longer copies the whole library on every run: the share
  replaced the modification time set on each copy when it closed the file, so every file looked changed
  the next time. The time is now set after the copy is renamed into place, and a warning names the copies
  whose time still did not stay. The first backup after this copies everything once more.

## [1.24.3] - 2026-10-26

### Changed

- The sync plan table keeps each count clearly under its own header (right aligned, wider gutter), dims
  zeros, and puts the counts the command acts on in bold: Add for `--push` (and Prune with `--prune`),
  +Spotify, -Spotify and Pull for `--pull`, in the table and the totals line.

## [1.24.2] - 2026-10-26

### Fixed

- Adding or removing a value of a multi value field (`musicman edit picks=+Hot`, `sync --pull`) no longer
  wipes the field: the whole value was written as `undefined`.
- A song with several files linked to one Spotify track (an album and a compilation copy, a repeated
  download) no longer shows that track as to prune when only one copy has the playlist's tag, and
  `sync --pull` tags every copy.

## [1.24.1] - 2026-10-24

### Changed

- CHANGELOG.md follows Keep a Changelog: entries are written by hand under `[Unreleased]`, and `pnpm release`
  moves them into the new version's section. Older versions were converted, and the tags that had no section
  now have one.
- `pnpm release` uses `commit-and-tag-version` instead of the deprecated `standard-version`, and stops before
  bumping the version when `[Unreleased]` has no entries.

## [1.24.0] - 2026-10-24

### Added

- Record tag and Spotify changes of each run and undo them with musicman undo

## [1.23.1] - 2026-10-24

### Fixed

- Score songs from live albums below studio Spotify matches

## [1.23.0] - 2026-10-24

### Added

- Score Spotify match similarity, auto-accept close matches, and play both versions in review

## [1.22.1] - 2026-10-22

### Fixed

- Retry Spotify token requests and show review picks in aligned columns

## [1.22.0] - 2026-10-22

### Added

- Recheck existing Spotify matches and accept or reject them in review

## [1.21.3] - 2026-10-21

### Fixed

- Send Spotify matches of another mix, edit, or version to review

## [1.21.2] - 2026-10-21

### Fixed

- Reject words sync and sort do not take instead of ignoring them

## [1.21.1] - 2026-10-21

### Fixed

- Reject a first word that is not a command instead of viewing the library

## [1.21.0] - 2026-10-21

### Added

- Publish a local build of every commit for the musicman alias

## [1.20.0] - 2026-10-21

### Added

- View and playlist use the whole library when no directory is given

## [1.19.0] - 2026-10-21

### Added

- Limit sync to songs matching sync.scope and add sync --backup --force

## [1.18.0] - 2026-10-21

### Added

- Add sync --backup and save Spotify lists before every push
- Back up the database automatically once a week

### Fixed

- Keep ID3 frames node-id3 cannot read when writing tags
- Write tags to files with an empty UFID frame and cap search query length

## [1.17.0] - 2026-10-21

### Added

- Sync playlist changes made on Spotify back into tags

## [1.16.0] - 2026-10-21

### Added

- Add the spotDL download script and sync --import
- Cache sync --match lookups in dry runs and save results per chunk
- Color the sync --match and db --update status lines
- Scan the whole library recursively with stats when no target is given
- Stop sync --match at long Spotify rate limits and add --verbose

### Fixed

- Archive runs stopped by a closed terminal as interrupted
- Pace the Spotify playlist refresh and push requests like the lookups

## [1.15.0] - 2026-10-21

### Added

- Add --format (oneline, csv, json, html) and --fzf to list output
- Add logs command to view archived runs
- Archive runs that change something and keep progress as a footer
- Write Spotify fields as sp_ tags with verbose sync --match output

## [1.14.0] - 2026-10-20

### Added

- Add --help and --version
- Add sort command to move rated songs out of Unrated with beets
- Show colored level badges on terminal log lines
- Write a download manifest with sync --pull

### Fixed

- Report no matches in edit before building the confirmation prompt

## [1.13.0] - 2026-10-20

### Changed

- **Breaking:** Numeric output.verbosity and logger.file.level values are no longer accepted; use a level name.

### Fixed

- Use log level names for output.verbosity and logger.file.level
- Use process.stdout.columns instead of term-size
- Write playlist paths relative to the MPD music directory

## [1.12.0] - 2026-10-20

### Added

- Add sync config, Spotify tables, and beets Spotify id reader
- Find Spotify track ids for songs with sync --match
- Push Liked Songs and playlist changes with sync --push
- Refresh the Spotify playlist cache and report the sync plan

### Fixed

- Keep a successful Spotify login when the user lookup fails

## [1.11.0] - 2026-10-20

### Added

- Add Spotify login and API client for sync

## [1.10.0] - 2026-10-20

### Added

- Write log messages to a log file

### Fixed

- Match songs without a multi value field for empty filters

## [1.9.0] - 2026-10-20

### Added

- Add search command with --add and --play
- Back up the library database before writes and with db --backup

### Fixed

- Escape backslashes in MPD arguments and add command lists

## [1.8.0] - 2026-10-20

### Added

- Read stats, view, and edit metadata from the library database

### Fixed

- Stop truncating piped output on large results

## [1.7.0] - 2026-10-20

### Added

- Add database config with defaults in the mpd base directory
- Add sqlite library database with db and db --update commands

### Fixed

- Parse playlist write switch and long form switches
- Reject when reading duration or size fails in full metadata reads

## [1.6.1] - 2026-10-20

### Fixed

- Write file reading progress to stderr only in a terminal

## [1.6.0] - 2026-10-20

### Added

- Add populated tag counts to stats command

### Fixed

- Continue without current song when MPD is not running
- Map year to ID3v2.3 TYER frame
- Render stats for configured multi fields instead of fixed indexes

## [1.5.0] - 2026-10-20

### Fixed

- Run notify daemon as systemd user service instead of forever

## [1.4.1] - 2026-10-20

### Fixed

- Render output columns with cli-table3 instead of columnify fork

## [1.4.0] - 2026-10-20

### Added

- Configure views per output format
- Read and write metadata using library.tags

### Changed

- **Breaking:** Tags no longer controls which metadata is read or written, only tags listed in library.tags are. library.tags only supports text (T***) and custom (TXXX.*) frames.
- **Breaking:** Output.table, output.vertical, and tags[].tableOrder are no longer supported; use views.table and views.list instead.

## [1.3.0] - 2026-10-20

### Added

- Add comprehensive configuration management system
- Add comprehensive configuration validation and library management

### Fixed

- Resolve all failing unit tests

## [1.2.0] - 2025-07-27

### Changed

- Consistent ID3 tag names in tags.json

## [1.1.1] - 2025-07-27

Maintenance release with no user-facing changes.

## [1.1.0] - 2025-01-27

### Added

- Development guidelines (CLAUDE.md) and a changelog policy in the project outline

### Changed

- Updated CLI and root dependencies to their latest patch and minor versions

### Fixed

- Address security vulnerabilities by updating outdated dependencies

## [1.0.24] - 2025-07-25

### Added

- Duration and file size in full metadata
- Formatted stats output

### Fixed

- Current playing song as the default target

## [1.0.23] - 2021-10-23

### Fixed

- Paths with glob special characters

## [1.0.22] - 2021-09-28

### Changed

- Quieter output

## [1.0.21] - 2021-08-01

Maintenance release with no user-facing changes.

## [1.0.20] - 2021-03-28

### Added

- Logging in playlist stats

### Fixed

- Buffer overflow when iterating large playlists

## [1.0.19] - 2020-05-09

Maintenance release with no user-facing changes.

## [1.0.18] - 2020-05-09

Maintenance release with no user-facing changes.

## [1.0.17] - 2020-04-13

### Changed

- Notification daemon updates

## [1.0.16] - 2020-02-17

### Added

- Confirmation before editing more than one file
- YAML config files

## [1.0.15] - 2020-02-15

Maintenance release with no user-facing changes.

## [1.0.14] - 2020-02-10

### Added

- Notification daemon for song changes
- Client player layout (mock data)

## [1.0.13] - 2020-02-09

Maintenance release with no user-facing changes.

## [1.0.12] - 2020-02-09

### Added

- First version of the stats command

## [1.0.11] - 2020-02-01

Maintenance release with no user-facing changes.

## [1.0.10] - 2020-01-27

### Changed

- Clearer output of the differences an edit makes

## [1.0.9] - 2020-01-27

Maintenance release with no user-facing changes.

## [1.0.8] - 2020-01-27

Maintenance release with no user-facing changes.

## [1.0.7] - 2020-01-27

### Added

- Aggregate assignment to multi value fields
- Better vertical output

### Fixed

- Uninitialized multi value fields no longer show undefined values

## [1.0.6] - 2020-01-24

Maintenance release with no user-facing changes.

## [1.0.5] - 2020-01-23

Maintenance release with no user-facing changes.

## [1.0.4] - 2020-01-23

### Added

- CLI field assignment operator for editing tags

### Changed

- CLI parser rewritten, with tests for the parser and the view, edit, and playlist commands

## [1.0.3] - 2019-11-11

### Added

- MPD integration in the server, with MPD events pushed to the client over websockets

## [1.0.2] - 2019-11-10

### Added

- Material UI in the client

## [1.0.1] - 2019-11-09

### Added

- Initial server with music-metadata handlers and the first routes
- React client scaffold

[Unreleased]: https://github.com/njhoffman/musicman/compare/v1.27.0...HEAD
[1.27.0]: https://github.com/njhoffman/musicman/compare/v1.26.1...v1.27.0
[1.26.1]: https://github.com/njhoffman/musicman/compare/v1.26.0...v1.26.1
[1.26.0]: https://github.com/njhoffman/musicman/compare/v1.25.1...v1.26.0
[1.25.1]: https://github.com/njhoffman/musicman/compare/v1.25.0...v1.25.1
[1.25.0]: https://github.com/njhoffman/musicman/compare/v1.24.4...v1.25.0
[1.24.4]: https://github.com/njhoffman/musicman/compare/v1.24.3...v1.24.4
[1.24.3]: https://github.com/njhoffman/musicman/compare/v1.24.2...v1.24.3
[1.24.2]: https://github.com/njhoffman/musicman/compare/v1.24.1...v1.24.2
[1.24.1]: https://github.com/njhoffman/musicman/compare/v1.24.0...v1.24.1
[1.24.0]: https://github.com/njhoffman/musicman/compare/v1.23.1...v1.24.0
[1.23.1]: https://github.com/njhoffman/musicman/compare/v1.23.0...v1.23.1
[1.23.0]: https://github.com/njhoffman/musicman/compare/v1.22.1...v1.23.0
[1.22.1]: https://github.com/njhoffman/musicman/compare/v1.22.0...v1.22.1
[1.22.0]: https://github.com/njhoffman/musicman/compare/v1.21.3...v1.22.0
[1.21.3]: https://github.com/njhoffman/musicman/compare/v1.21.2...v1.21.3
[1.21.2]: https://github.com/njhoffman/musicman/compare/v1.21.1...v1.21.2
[1.21.1]: https://github.com/njhoffman/musicman/compare/v1.21.0...v1.21.1
[1.21.0]: https://github.com/njhoffman/musicman/compare/v1.20.0...v1.21.0
[1.20.0]: https://github.com/njhoffman/musicman/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/njhoffman/musicman/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/njhoffman/musicman/compare/v1.17.0...v1.18.0
[1.17.0]: https://github.com/njhoffman/musicman/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/njhoffman/musicman/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/njhoffman/musicman/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/njhoffman/musicman/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/njhoffman/musicman/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/njhoffman/musicman/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/njhoffman/musicman/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/njhoffman/musicman/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/njhoffman/musicman/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/njhoffman/musicman/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/njhoffman/musicman/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/njhoffman/musicman/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/njhoffman/musicman/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/njhoffman/musicman/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/njhoffman/musicman/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/njhoffman/musicman/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/njhoffman/musicman/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/njhoffman/musicman/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/njhoffman/musicman/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/njhoffman/musicman/compare/v1.0.24...v1.1.0
[1.0.24]: https://github.com/njhoffman/musicman/compare/v1.0.23...v1.0.24
[1.0.23]: https://github.com/njhoffman/musicman/compare/v1.0.22...v1.0.23
[1.0.22]: https://github.com/njhoffman/musicman/compare/v1.0.21...v1.0.22
[1.0.21]: https://github.com/njhoffman/musicman/compare/v1.0.20...v1.0.21
[1.0.20]: https://github.com/njhoffman/musicman/compare/v1.0.19...v1.0.20
[1.0.19]: https://github.com/njhoffman/musicman/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/njhoffman/musicman/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/njhoffman/musicman/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/njhoffman/musicman/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/njhoffman/musicman/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/njhoffman/musicman/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/njhoffman/musicman/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/njhoffman/musicman/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/njhoffman/musicman/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/njhoffman/musicman/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/njhoffman/musicman/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/njhoffman/musicman/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/njhoffman/musicman/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/njhoffman/musicman/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/njhoffman/musicman/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/njhoffman/musicman/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/njhoffman/musicman/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/njhoffman/musicman/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/njhoffman/musicman/releases/tag/v1.0.1
