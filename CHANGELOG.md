# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `musicman ui` serves a management page on `127.0.0.1` (`ui.port`, 6660) until ctrl-c. It lists the
  Spotify matches waiting for review, those accepted in review, and the tracks rejected for a song; picking
  one shows the local file and the Spotify track side by side with their differences marked, plays the
  file in the page and the track in Spotify's embedded player (full tracks when the browser is logged in
  to Spotify, else previews) or the desktop app, and accepts or rejects. Accepted matches can be rejected
  and rejected tracks accepted after all. Each action is an archived `ui` run whose tag changes
  `musicman undo` restores, like `sync --review`. It also lists, as of the last sync, the tracks in mapped Spotify playlists missing from the
  library and the songs that belong on Spotify but have no Spotify id.
- Rejecting a match keeps the candidate's title, artists, album, and length, so the rejected list can
  show it after the song is looked up again; older rejections are looked up on Spotify once.

### Changed

- Accepting a track takes it off the song's rejected tracks.

## [1.39.0] - 2026-11-01

### Added

- zsh completion of tag values after `field:` and `field=` (one more after each comma, and after `+` or
  `-` in an assignment), rating steps after `rating:`, run ids for `undo` and `logs`, `liked` and the
  cached Spotify playlist names for `shuffle`, and `shuffle on|off|toggle` and `repeat
  off|playlist|track|next` for `spotify`. Values and playlist names are read from the library database
  with the `sqlite3` command when Tab is pressed (no node startup); without `sqlite3` only the field names
  complete.

### Fixed

- Unquoted `~field:` exclusions complete in zsh. The script also completes the `-tilde-` context: field
  names and values for `musicman`, the usual home directories for every other command.

Generate the script again (`musicman completion zsh > ~/.zsh/completions/_musicman`) to get these.

## [1.38.0] - 2026-11-01

### Added

- `musicman status` names the source of a `musicman shuffle` as where the song plays from (`shuffle
  "Liked Songs"`), both while the shuffled tracks play as a list without a Spotify context and when the
  shuffle playlist itself plays. `shuffle` keeps the shuffled track ids in the database for this.

## [1.37.1] - 2026-11-01

### Changed

- Include and exclude filters (`field:value`, `~field:value`) share one matcher; what they match is
  unchanged.

## [1.37.0] - 2026-11-01

### Changed

- Spotify album metadata only goes to songs organized in albums. `sync --match` tells albums from
  singles by the beets path rule the song's folder matches (an album rule has `$album`). Singles no longer
  get album artist, track and disc numbers, total tracks, label, UPC, copyright, album popularity, album
  image, or album genres, and lose those frames on their next field refresh (`sync --match --refresh` for
  all of them now). Every song keeps `sp_album`, `sp_album_id`, `sp_album_type`, and the release date
  with its year fallback, but singles no longer get the `album` tag filled from Spotify. Downloads
  tagged by `sync --import` count as singles until beets sorts them into an album folder.
- `spotify.fields` entries take `scope: album` (field only on songs in albums) and `fallbackScope: album`
  (field on every song, fallback only on songs in albums).
- `sync --match` shows album fields it removed (`-N removed`, and the names with `--verbose`).

## [1.36.0] - 2026-11-01

### Added

- `musicman check [target]` reports library problems without changing anything: database drift,
  unreadable files, frames a tag rewrite would lose, custom field names that differ only by case or
  punctuation, custom fields duplicating standard frames, leftover `spotify_track_id` frames, multi value
  formatting and case variants, ratings off the half step scale, garbled text, and duplicate songs (by
  Spotify id, MusicBrainz id, or artist, title, and length). `--only` picks checks, `--all` lists every
  finding, `--format=json` prints them for scripts; it exits 1 when something is found.

## [1.35.0] - 2026-11-01

### Added

- `musicman player` controls whichever of MPD and the Spotify desktop app is active, or the one named
  first: play, pause, stop, skip, seek (relative or to a position), volume (relative or a percent),
  shuffle, repeat, the upcoming queue, and playing or queueing `search` results (`player play
  context:Study`), on Spotify by the songs' Spotify ids.
- Song change notifications for the Spotify desktop app as well as MPD (`musicman-notify`): the rating as
  stars, the title, artist and album, the song's tags colored per field, and the cover; Spotify songs
  without a library match say so. Each notification replaces the last one.

### Changed

- Notifications fire only when a new track starts, not on pause or seek, and the daemon reconnects when
  MPD restarts instead of exiting. `daemon.icon` (the cover) is on by default, and `daemon.fields`
  defaults to context, mood, and picks.

## [1.34.0] - 2026-11-01

### Added

- `musicman menu` has a details screen (`i`): the file (path, size, modified) and every tag with a value,
  or the Spotify track for songs not in the library, with its Spotify link and the playlists it is in.
- A tags submenu (`e`) lists every picks, context, and mood value used on at least `menu.tagMinSongs` songs
  (5), the song's own values, and `menu.extraTags` for new ones; `menu.tagFields` picks the fields.
  Pressing a tag adds or removes it and keeps the submenu open. Typing filters the submenus.

### Changed

- The menu's tag buttons moved from the main screen to the tags submenu: `menu.buttons` are pinned first
  there and pressed with Alt and their key (`Alt+a`). The song's tags still show in the info box, as
  colored chips.
- The grouping button is captioned `genre` (the song's grouping when it has one).
- The menu opens with `next` selected, so Enter right away skips the song.
- Seek buttons move 30 seconds instead of 10.
- The menu always controls the player that plays (Spotify when both do); the `Tab` switch is gone.
- New look: wider panel, larger cover, a progress bar, colored stars and icons, buttons in two rows of
  nine, and the selected button framed instead of filled.

## [1.33.0] - 2026-11-01

### Added

- `musicman menu` has a grouping button (`g`): a second menu of the groupings used in the library sets
  the song's grouping, or moves a Spotify song not in the library between grouping playlists.
- The menu follows the song: when another track starts while it is open, it opens again with the new one.
- The menu's shuffle (`u`) and repeat (`r`) buttons work for MPD (random, repeat, single).

### Changed

- The menu's reshuffle button (`o`) shuffles the Spotify playlist or Liked Songs that is playing, and only
  falls back to the last `musicman shuffle` source for albums, artists, and track lists.

### Fixed

- The menu's like button shows whether Spotify has the track in Liked Songs now, not as of the last sync,
  so liking a song already liked in the app no longer records an add that undo would remove.

## [1.32.1] - 2026-11-01

### Changed

- A copy of `.musicmanrc.yml` in the repository root is ignored by git; the user config is
  `~/.musicmanrc.yml`.

## [1.32.0] - 2026-11-01

### Added

- `musicman status`: the now playing screen for MPD or Spotify, with the player's volume, shuffle, and
  repeat, a progress bar, the song's rating, grouping, and multi value fields, the Spotify playlists that
  hold it, where it plays from (MPD queue position, or the Spotify playlist, album, or artist), and its
  file. `--watch` (`-W`) redraws it every second until `q`; `--format json` prints it as data;
  `status.icons: false` drops the Nerd Font icons.

### Changed

- `musicman` without arguments shows `musicman status` while MPD or Spotify plays or is paused, including
  Spotify songs, instead of the tag list of the MPD song; with nothing playing it still views the current
  directory. `musicman view` still lists the playing MPD song's tags.
- Commands that never act on the playing song (`sync`, `sort`, `logs`, `undo`, `search`, `menu`,
  `shuffle`, `spotify`, `status`) no longer wait for MPD to report it, up to 2 seconds when MPD is down.

## [1.31.0] - 2026-11-01

### Added

- `musicman shuffle` plays a Spotify source in a uniformly random order: Liked Songs (`liked`), one of your
  playlists by name, a playlist URL, or library filters (`rating:4.5 grouping:Dubstep`). It writes the
  tracks in random order to your own playlist `musicman shuffle` (`shuffle.playlist`, created on first
  use, rewritten each run) and plays the first tracks of that order (up to 1000) with Spotify's shuffle
  off on the active device, so Spotify's artist spreading and reused queue orders no longer apply. Your
  playlists are never reordered. Without a source it shuffles the last one again; `--dry-run` only counts
  the tracks. Playback needs Premium; `sync --login` now also asks for the playback scopes.
- `musicman spotify` shows Spotify's shuffle and repeat, and sets them: `shuffle on|off|toggle`,
  `repeat off|playlist|track|next`.
- `musicman menu` has shuffle (`u`), repeat (`r`), and reshuffle (`o`, the last `musicman shuffle`
  source) buttons for Spotify, drawn disabled for MPD.
- A README with an overview, links to the docs, and why Spotify's shuffle repeats itself.

### Fixed

- Spotify API calls that succeed with a plain text body (player commands) no longer fail with a JSON
  parse error.

## [1.30.0] - 2026-10-31

### Added

- `stats` counts the songs matching each `stats.filters` entry (name and filter, in the view/search filter syntax)
  in a Filters section, with the share of the scanned files; also in `--format` output. The defaults count songs
  rated 4.0+, 4.5+, 5.0, and singles rated 4.0+ (`grouping:Singles`), replacing a `type:singles` filter on a
  tag that does not exist. Each entry needs a name and a filter.

### Changed

- The table view option `views.table.seperators` is now spelled `views.table.separators`; a config that still
  uses the old key fails validation with a message naming the new one.
- Confirmation prompts (`edit` on several files, `sync`, `sort`, `undo`) use `@inquirer/confirm`; the answer
  still defaults to no, and Ctrl+C or a closed input now answers no instead of erroring.

### Removed

- The unused `library.tagId` option; musicman always reads and writes ID3v2.3 frames. A config that still sets
  it gets an unknown option warning.

### Fixed

- MPD replies keep values that contain a colon: for a song at `Artist/Live: 1999/...` or titled `Intro: Part 1`
  the value was cut at the second colon, so commands run on the playing song and the notify daemon read the
  wrong file.

## [1.29.0] - 2026-10-28

### Added

- `musicman menu` opens a rofi menu for the song playing in MPD or Spotify (`docs/07-menu.md`), bound to
  `$mod+Shift+m` in i3: prev, play/pause, next, seek and volume with the same layout for both players, the
  source shown in the title and accent color, and the cover beside the song's details. `Tab` switches player.
- Menu buttons from `menu.buttons` (e.g. `context:Study`, `picks:Hot`) and `menu.ratings` (4, 4.5, 5) tag or
  rate the playing song: MPD songs locally, Spotify songs in the library locally and pushed to Spotify right
  away, other Spotify songs by adding them to the matching `sync.playlists` entry. Like and ignore buttons
  for Spotify songs not in the library. Each press is its own run, so `musicman undo` takes back one.
- `sync.ignorePlaylist`: tracks in this Spotify playlist are never listed to pull or download, and never
  matched to a song.
- A Spotify song pulled from a rating playlist (`rating:4.5-4.5`) gets that rating on `sync --import`.

## [1.28.1] - 2026-10-28

### Fixed

- Rating filters compare ratings as numbers, so `rating:4-4` and `rating:3.5-4` include songs rated 4.0;
  before, a whole-number upper bound left them out.

## [1.28.0] - 2026-10-27

### Added

- `musicman completion zsh` prints a zsh completion script: commands, each command's switches and aliases,
  `--format` values, field names for `field:value`, `~field:value`, `field=value`, and `-i`/`-x` lists,
  paths, and `latest` for `undo` and `logs`. Field names are those of `library.tags` when the script is
  generated. Install it as `_musicman` in a directory on `$fpath`, or `source <(musicman completion zsh)`.
  Completion needs `musicman` to be a function or an executable, not an alias.

## [1.27.1] - 2026-10-27

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

[Unreleased]: https://github.com/njhoffman/musicman/compare/v1.39.0...HEAD
[1.39.0]: https://github.com/njhoffman/musicman/compare/v1.38.0...v1.39.0
[1.38.0]: https://github.com/njhoffman/musicman/compare/v1.37.1...v1.38.0
[1.37.1]: https://github.com/njhoffman/musicman/compare/v1.37.0...v1.37.1
[1.37.0]: https://github.com/njhoffman/musicman/compare/v1.36.0...v1.37.0
[1.36.0]: https://github.com/njhoffman/musicman/compare/v1.35.0...v1.36.0
[1.35.0]: https://github.com/njhoffman/musicman/compare/v1.34.0...v1.35.0
[1.34.0]: https://github.com/njhoffman/musicman/compare/v1.33.0...v1.34.0
[1.33.0]: https://github.com/njhoffman/musicman/compare/v1.32.1...v1.33.0
[1.32.1]: https://github.com/njhoffman/musicman/compare/v1.32.0...v1.32.1
[1.32.0]: https://github.com/njhoffman/musicman/compare/v1.31.0...v1.32.0
[1.31.0]: https://github.com/njhoffman/musicman/compare/v1.30.0...v1.31.0
[1.30.0]: https://github.com/njhoffman/musicman/compare/v1.29.0...v1.30.0
[1.29.0]: https://github.com/njhoffman/musicman/compare/v1.28.1...v1.29.0
[1.28.1]: https://github.com/njhoffman/musicman/compare/v1.28.0...v1.28.1
[1.28.0]: https://github.com/njhoffman/musicman/compare/v1.27.1...v1.28.0
[1.27.1]: https://github.com/njhoffman/musicman/compare/v1.27.0...v1.27.1
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
