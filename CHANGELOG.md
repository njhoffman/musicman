# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- An edit with a field that is not a library tag (or rating), e.g. `contxt=Study`, stops with an error naming
  the fields; before, it wrote nothing and said nothing.
- Reading tags from files reads only the tag, not the whole mp3: `stats --files` on the full library takes 34
  seconds instead of 2 minutes 19, and `view --files`, `edit`, and `db --update` read faster too.

## [1.68.0] - 2026-11-03

### Changed

- A filter with a field that is not a library tag (or rating) is an error: in `stats.filters`, `sync.playlists`,
  and `menu.buttons` musicman refuses to start until it is fixed, and on the command line the command stops
  (`search` and `player` still take such a term as text). Before, the term was ignored, so a typo matched every
  song, and a push would have added the whole library to that playlist.

### Removed

- The default `stats.filters` entry "Singles rated 4.0+" (`rating:4.0 grouping:Singles`): `grouping` is not a
  default library tag, so it only ever counted `rating:4.0`. Configs with `grouping` can add it to their own
  `stats.filters`.

### Fixed

- Reading many files from disk (`stats --files`, `view --files`) kept every mp3 in memory: 3.2 GB for the whole
  library, now 726 MB.
- `check --fix` reads only the tag of each file it plans to change, not the whole file (about 7 times faster).

## [1.67.0] - 2026-11-03

### Added

- Spotify local files (songs added with `sync --export`) are recognized while they play, in the desktop app
  or on another device: `musicman menu`, `musicman status`, and the song notifications find the library song
  by title, artist, and length. In the menu its tags and rating are written to the file, with nothing pushed;
  a local file with no library song shows as not in the library.

### Fixed

- The sync plan's `Local files` column still counted Liked Songs at 0 after `sync --export --confirm`; the
  plan now counts the confirmed songs too, the same way the export does.

## [1.66.0] - 2026-11-03

### Added

- `musicman ui` downloads the queued Spotify tracks: Download in the Spotify to local tab runs the download
  script in the background with progress and its last output lines, and Cancel stops it. The download goes
  on when the page or the server closes.
- `pnpm download` runs are archived as `download` runs (`musicman logs`), and a second download refuses to
  start while one runs, from the page or a terminal.

### Fixed

- A download stopped with ctrl-c left the track being converted cut short under its final name, which the
  next run skipped as downloaded and `sync --import` imported. Untagged downloads are now deleted after a
  stop and before every run, and the ffmpeg conversions spotDL leaves running are stopped too.

## [1.65.1] - 2026-11-03

### Changed

- Developer docs brought in line with the code: `cli/CLAUDE.md` rewritten, `docs/01-outline.md` shows the
  current layout; the root `CONTEXT.md` session notes are removed.

### Removed

- Stale tracked files: old test output, session notes (`cli/SESSION_SUMMARY.md`, `cli/CONTEXT.md`), and
  `docs/scratch.md`.

## [1.65.0] - 2026-11-02

### Fixed

- `sync --export` counted Liked Songs at 0 of its local files forever and staged them again on every run:
  the Web API never lists local files in Liked Songs. After dragging the staged songs in, `sync --export
  --confirm` (`-y`) records them as added, and later exports stage only songs liked since.

## [1.64.0] - 2026-11-02

### Added

- `musicman menu` and `musicman player` control Spotify playing on another device (a phone, a speaker) through
  the Web API when the desktop app is not running; the title names the device. The Web API is asked only when
  neither the desktop app nor MPD is playing. With the desktop app open it mirrors the other device and
  controls it as before.

## [1.63.0] - 2026-11-02

### Added

- `musicman menu` details (`i`): Enter on a line copies its value (the file path, the Spotify link, a tag's
  values) to the clipboard with `wl-copy` under Wayland, else `xclip`, and goes back to the main menu.

## [1.62.1] - 2026-11-02

### Fixed

- `sync --export` stuck on a playlist whose songs never appear in the desktop app's Local Files: `.mp3` files
  holding MPEG layer II (MP2) audio, which Spotify does not list. The export reads each file's first audio
  frames, leaves such songs out of `files/`, `stage/`, and the playlists' counts, and lists them in the output
  and the checklist (2 of the 623 songs).

## [1.62.0] - 2026-11-02

### Changed

- The database records when each song's rating last changed (`rated_at`, schema 11): `db --update` stamps it
  whenever it reads another rating than it stored, whoever wrote it (the menu, the page, `edit`, another
  tool). The duplicates repair gives the kept copy the rating set last by that time, rather than the rating of
  the copy whose file is newest, which any tag write (artwork, Spotify fields) made newer. Ratings from before
  this version have no time; between those the file time still decides.
- The database moves to schema 11 the first time this version opens it; older versions refuse it afterwards,
  so update the notify daemon along with the cli.

## [1.61.0] - 2026-11-02

### Added

- `musicman values [field ...]` lists the values of library fields with the number of songs that have each,
  most used first, from the library database (about a second, where `stats` scans every file); without
  fields it lists `menu.tagFields`. `--format json` is part of the contract for other programs
  (docs/09-contract.md): fzx's music module offers the values in its tag editor.

## [1.60.0] - 2026-11-02

### Added

- `db --excluded` (`-K`) lists the songs taken out of the library (duplicate copies whose files stay, and
  trashed ones, marked), with the reason and the copy kept instead; `db --readmit [path]` (`-G`) lets one back
  in, read into the database again, or picks several with fzf from a directory (the whole library without a
  path). Readmits are recorded, so `musicman undo` excludes them again. Until now only `musicman undo` could
  bring a song back, and only while its run was in the kept history.

## [1.59.0] - 2026-11-02

### Added

- `sync --match --recheck` also moves matches that pair a live song with a studio track, or a studio song with
  a live track, to review (they stay linked until accepted or rejected): links made before 1.56.0, when
  matching did not tell them apart. The summary says how many moved for that reason.

## [1.58.2] - 2026-11-02

### Fixed

- The `sync --export` checklist (`README.md`) is dated in the local time zone, not a day ahead in the evening.

## [1.58.1] - 2026-11-02

### Fixed

- A progress line with wide characters (a CJK song name while copying to the phone) wrapped and left its rule
  on screen: the status line is now cut by its width on screen, two columns for CJK, and emoji are no longer
  split in half.

## [1.58.0] - 2026-11-02

### Added

- `sync --export` mirrors the exported songs to the phone set in `sync.phone` (a KDE Connect device and a folder
  in its storage, `Music/musicman` by default): it mounts the phone over KDE Connect's SFTP plugin, copies the
  songs new or changed since the last copy (with a progress bar), removes the ones it copied that left the
  export, and unmounts. Files it did not copy are never touched; a failed copy stops it, and the next run goes
  on from there.

## [1.57.2] - 2026-11-02

### Changed

- The sync runbook points to the `~/.shell` spotify recipe for desktop playback of local files: the apt client
  only loads ffmpeg 4.x, and the recipe builds and links a minimal ffmpeg 4.4 for it.

## [1.57.1] - 2026-11-02

### Fixed

- `sync --export` has the short alias `-e`; `--help` listed it as `--export, undefined`.

## [1.57.0] - 2026-11-02

### Added

- `sync --export` brings the songs Spotify has no track for to their playlists as Local Files: `files/` in
  `sync.uploadDirectory` holds each once (hard links, synced to the phone, where Spotify plays them), and
  `stage/` the songs still missing from one playlist at a time, to drag into it in the desktop app. Each run
  checks the playlists' local tracks (by artist, title, and length), stages the next playlist, and writes a
  `README.md` checklist. The plan shows a `Local files` column (added of needed per playlist). The workflow is
  in `docs/06-spotify-sync-runbook.md`.

## [1.56.1] - 2026-11-02

### Changed

- The contract lets sleeve replace the plain lyrics beets writes on import with synced ones; synced lyrics already in a
  file still stay unless sleeve is told to replace them.

### Fixed

- `sync --pull` counted a song without a Spotify id once for every target it belongs in (4542 for 913 songs),
  and always told to run `sync --match` first. It now counts each song once and says what they are: not
  looked up yet, not found on Spotify, in review, or rejected; only songs never looked up still warn that the
  manifest may list songs you have. The plan's total counts each song once too.

## [1.56.0] - 2026-11-02

### Changed

- `sync --match` matches a live recording only to a live track and a studio recording only to a studio
  track, ISRC lookups included (a live file can carry its studio song's ISRC), so a live copy whose studio
  match was rejected now finds its own live track. A song is live by its `live` folder, MusicBrainz album
  type, album, or title; a track by its title or album.

### Fixed

- `check --fix` no longer lists a live or remix copy as "re-match" on every run once its match is rejected
  and it is linked to no track; a copy matched without a Spotify id tag (by its match or review row) is
  cleared too, and an excluded copy's Spotify track is taken from its match when it has no tag.

## [1.55.1] - 2026-11-02

### Added

- The contract (`docs/09-contract.md`) says who writes the lyrics in the library's tags: sleeve writes `USLT` and
  `SYLT` only, and musicman never changes them on its own, carrying both over when it rewrites a tag.

## [1.55.0] - 2026-11-02

### Added

- A contract for programs that build on musicman, starting with sleeve (synced lyrics): `paths.json` in
  `$XDG_STATE_HOME/musicman/` says where MPD, the library and its database are, rewritten by the cli and the
  notify daemon when the config changes; the database's new `spotify_track_files` view lists the library files
  for each Spotify track id. Both are described in `docs/09-contract.md`.

### Changed

- `sync` shows a progress bar while it refreshes the Spotify playlists (playlists done, ETA, and the
  tracks fetched of the one being fetched), also after `--push`.
- The database moves to schema 10 (the view) the first time this version opens it; older versions refuse it
  afterwards, so update the notify daemon along with the cli.

## [1.54.0] - 2026-11-02

### Added

- `check --pick` (`-k`) goes through the duplicate groups no rule decides one at a time in fzf, with
  each copy's length, size, audio CRC, rating, and title; the copy picked is kept right away, `skip`
  leaves a group for later, `stop` ends.
- The Duplicates tab of `musicman ui` lists only the groups to pick on request, shows each copy's size,
  audio CRC, and rating, and moves on to the next group after a repair.

### Changed

- `check` lists every finding and every planned change; its `--all` switch is gone (`sort --all` stays).
- `check --fix` repairs every duplicate group the rules decide after one confirmation, without fzf; the
  groups that need a pick are left for `check --pick` or the page.
- Identical copies that tie are decided by the file name closest to the ID3 title, then to the Spotify
  artist and title; the others go to the trash from a Singles folder, or leave the library elsewhere.

## [1.53.0] - 2026-11-02

### Changed

- `check --fix` deletes fewer duplicate files. Only a single in a `Singles` or `_Singles` folder whose
  album copy (under `Artists`) is kept, and a numbered copy with the same audio, go to the trash. Other
  copies (compilations, EPs, `single` releases, copies not picked) leave the library and the Spotify
  playlists, but their files stay: they are listed as excluded, so `db --update`, the commands reading
  the library, and the drift check skip them, and `sync --push` removes their Spotify tracks. Numbered
  copies with other audio are picked instead of trashed. `musicman undo` lets excluded songs back in.

## [1.52.0] - 2026-11-02

### Added

- `check --fix` repairs duplicates: an album copy is kept over EPs, singles, and compilations, a Rated
  copy over `Unrated/` imports, and a file over its numbered copies (`Song.1.mp3`); a live or remix
  copy, or one with a version in its title, keeps its file and has its wrong Spotify match cleared. The
  kept copy gets the removed copies' context, picks, and mood values and the newer rating. Copies no rule
  decides are picked in fzf, and the plan is confirmed in fzf. Removed copies leave beets and go to
  `<db.backupDirectory>/trash/`; `musicman undo` moves them back and imports them into beets again.
- `musicman ui` has a Duplicates tab: every copy to play, the copy to keep picked in the page, and
  repairs of one group or every decided group, undone from the History tab.

### Changed

- `check --fix` names the checks it found problems in that have no automatic repair.
- `musicman undo` lists and undoes moved files (`N moved` in `undo --list`).

## [1.51.0] - 2026-11-02

### Changed

- `sync` treats a Spotify track with the same ISRC as a library song (the single and the album
  release of one recording) as that song: `sync --pull` no longer lists it for download, its
  playlists reach the song's tags as changes made on Spotify, and `--push` does not add the
  library's release next to it. The first sync after upgrading fetches every playlist again to
  cache the ISRCs.

## [1.50.2] - 2026-11-02

### Changed

- The status line of long commands (progress bars) has a dim rule above it, so it stands apart from
  the log lines scrolling above it.

## [1.50.1] - 2026-11-02

### Changed

- `sync --match` (and `--recheck`) match and refresh every song in the library, also songs outside
  `sync.scope` (1.50.0 still left those out); `sync.scope` only decides what is pushed and pulled.

## [1.50.0] - 2026-11-02

### Added

- `check` has an `artwork` check: songs without an embedded cover, and whether Spotify has their album
  image. `check --fix` downloads the Spotify album cover (once per album) and embeds it as the front
  cover in the same tag write as the other repairs, so `musicman undo` removes it again.
- `sync --match --recheck` also looks matches on a compilation or various artists release up again: the
  same recording on the song's own album (by name), else an album, else a single, replaces the match;
  a better release that is only probable is reported as an album version to check.
- `sync.importLyrics: false` leaves the beets lyrics plugin (most of an import's time) out of
  `sync --import`, through a copy of the beets config with `lyrics.auto` off, and says how to fetch the
  lyrics afterwards.
- `sync --import` finishes an interrupted import first: downloads beets moved before it was stopped are
  added to the database, marked imported in the manifest (so `pnpm download` does not fetch them again),
  and their undo history is pointed at the library. Imports from before 1.49.1 are fixed the same way.

### Changed

- `sync --match` matches and refreshes every song in `sync.scope`, not only songs that belong in Liked
  Songs or a mapped playlist, so unrated imports get their Spotify fields refreshed too.
- Matching prefers the original release: among Spotify tracks that are the same recording, the song's
  own album, then an album, a single, a compilation, and a various artists release; ISRC lookups
  consider 10 results instead of 5.
- Singles get the `sp_` album fields (album artist, label, track and disc numbers, cover, ...) like songs
  in albums; only the standard album tags they fall back to stay limited to album folders
  (`fallbackScope: album`), so singles stay singles for beets and MPD.

- `sync --import` shows progress bars for tagging, the beets import (counted by the downloads beets
  has moved out of the download folder, with an ETA; elapsed time only when beets copies), and the
  database update. A real import writes the per-file TAG lines to the run log only; a dry run still
  lists them.
- `sync --import` removes the Spotify popularity spotDL writes to POPM (the rating frame, without an
  email) on purpose, unless a rating playlist sets the rating, and counts it in the summary (`popm`).
  The popularity stays in `sp_popularity`.

### Fixed

- The `sync --import` beets progress bar never showed (the beets `import.move` setting was not read),
  only the elapsed time.

## [1.49.1] - 2026-11-01

### Fixed

- `musicman undo` finds files that moved after a run instead of reporting them missing: when
  `db --update` (also run by `sort`) recognizes a moved song by its MusicBrainz track id, the run
  history follows it to the new path, and `sync --import` points the tags it wrote to each download at
  the file beets moved into the library (found by its Spotify track id). Songs without a MusicBrainz id
  are not followed yet.

## [1.49.0] - 2026-11-01

### Changed

- `check` and `check --fix` show a progress bar with rate and ETA while reading tags, planning repairs,
  and writing, instead of plain counters, and color the report and the repair plan: check names, `ok`
  and problem counts, change kinds (rename, remove, move, rewritten values), what is left for you, and
  muted paths. Output stays plain without a terminal and with `--format=json`.

## [1.48.0] - 2026-11-02

### Added

- `musicman ui` History tab: the page's accepts, rejects, and undos with what undoing each puts back,
  and Undo (Undo anyway when something changed since).
- `musicman ui` Spotify to local list: whether each track is in the download manifest (queued,
  downloaded, imported), Add to downloads for one track or every one not queued, and Refresh playlists
  to fetch the Spotify playlists again as `sync` does first.

### Changed

- Accepting and rejecting in review (`sync --review`, `musicman ui`) records the Spotify match rows it
  changes, and `musicman undo` puts them back (`MATCH` lines; `--force` for rows changed since), so an
  undone accept waits for review again instead of staying in Accepted. A reject that changed no tags can
  now be undone too. Database migration 6 adds the `match_changes` table.
- `sync --pull` writes the download manifest whole through a temporary file, so `pnpm download` never
  reads half of one.

- `musicman ui` keeps the transfer lists (Spotify to local, Local to Spotify) until the database
  changes, so going back to them no longer reads the whole library again; their Reload button
  computes them again.

## [1.47.0] - 2026-11-01

### Added

- `musicman ui`: Play here plays the full Spotify track in the page with the Spotify Web Playback SDK
  (Premium), loaded on first use and shown in Spotify Connect as "musicman ui" while the page is open.
  `musicman sync --login` asks for the permissions it needs (`streaming`, `user-read-email`,
  `user-read-private`), so a login from before needs to be repeated.
- `musicman ui`: `s` plays the Spotify version of the selected song (the candidate, the linked or only
  rejected track, or the previewed or first search result) in the page, or in the desktop app when the
  page cannot play it, and pauses or resumes it when pressed again. The local file and Spotify in the
  page pause each other.

## [1.46.0] - 2026-11-01

### Added

- `musicman ui`: a Not found tab with the songs `sync --match` found no candidate for, and a Spotify
  search in the panel of every song (run on its own on Not found once the selection stops): the query
  of `sync --match` or your own words, each result with its similarity, a preview, and Accept, which
  links the song to it as accepting a review candidate does. Tracks rejected for the song are marked.

## [1.45.0] - 2026-11-01

### Added

- `musicman ui`: column headers sort the lists, ascending, descending, then back to the default order
  (Similar least similar first, Length by the difference of the two lengths).
- `musicman ui`: keyboard review: `j`/`k` or the arrows move, space plays the local file, `a` accepts and
  `r` rejects and then selects the next song, `/` filters, Esc closes the song.
- `musicman ui`: a Reload button on each list, and every 15 seconds the page checks whether the lists
  changed since they were loaded (a `sync` in a terminal) and marks them.
- `musicman ui`: a banner while another musicman run is going on (`sync --match`, `--pull`, an import),
  and a question before each accept or reject while it runs.

### Changed

- `musicman ui`: the tabs are a tablist (arrow keys, Home, End), and screen readers hear which song is
  selected.
- Run reports record the pid of the run, so a run that crashed no longer counts as going on.

### Fixed

- `pnpm download`: one track spotDL cannot look up failed its whole batch; the tracks of a failed batch are
  now tried one by one, and the tracks still missing are listed with their URLs at the end.

## [1.44.0] - 2026-11-01

### Added

- `edit` and the menu file a song in `Unrated` away with beets as soon as a change gives it a rating and a
  grouping (or the grouping hint of a download), and show where it went; the menu reads the song, and
  pushes it to Spotify, from its new path.
- `musicman sort` lists the songs still waiting in `Unrated` with what each needs and its grouping hint
  (the first 10, `--all` for every one).

## [1.43.0] - 2026-11-01

### Added

- `musicman sort` moves a rated song without a grouping when it has the grouping hint `sync --import`
  left: it writes the hint to TIT1 (recorded for `musicman undo`) and beets moves the song.
- `pnpm download --limit N` downloads only the first N pending manifest tracks, e.g. for a trial run.

### Fixed

- `pnpm download` saved files to `musicman/download` in the music directory instead of
  `.musicman/download`: spotDL drops the leading dot of every directory in its output template, so it now
  runs inside the download directory with a file name template.

### Changed

- `sync --import` has beets import downloads as is (`import -s -q -A`) instead of autotagging them: the
  tags already describe the manifest's exact Spotify track, while beets' matches picked other releases of
  a song and wrote Spotify ids into the MusicBrainz fields. It is also much faster.
- The `sync --import` summary is aligned and colored like the backup summary, and also counts grouping
  hints, ratings, and playlist tags given, the database changes, and the manifest tracks left to import.
- `sync --import` keeps the grouping of a download's Spotify playlist in `TXXX.playlist_grouping` instead
  of TIT1, so beets files every download under `Unrated/_Singles` until it is rated, rather than putting
  unrated songs with a grouping straight into `Rated/`.

## [1.42.0] - 2026-11-01

### Changed

- `sync --push` no longer adds a track to a rating or grouping playlist when the files linked to it
  disagree on which one it belongs in (e.g. one copy rated 4.0, another 4.5): it goes in none of those
  playlists and stays where it already is until the copies agree. The plan's new `Conflict` column and a
  warning count them (`check --only=exclusive` lists them). The menu's immediate push does the same and
  says so in a notification.

## [1.41.1] - 2026-11-01

### Fixed

- Tag writes (`edit`, the menu, `check --fix`, sync) no longer drop the second of two frames node-id3
  holds once, e.g. a comment next to an `iTunNORM` COMM frame: the dropped frames are copied back and the
  frame node-id3 reads stays the one it reads. `check` reports such frames where a rewrite cannot keep
  them (tags other than plain ID3v2.3).
- `check --fix` shows long and multi line values (lyrics, album notes) on one line, cut to 80 characters.
- `musicman check` names the same spelling `check --fix` renames to (a configured tag id or a `check.names`
  entry first); it suggested the most used one even when the fix picked another.
- `check --fix` removes a multi value field left with no items (written as `''` or `,`); `check` reported
  it on every run and the fix never changed it.
- A custom field in the config that is only spelled differently (e.g. `TXXX.replaygain_track_gain` to
  `TXXX.REPLAYGAIN_TRACK_GAIN`, same single or multi value) updates its stored definition instead of
  stopping every command with "Custom field definitions changed".

## [1.41.0] - 2026-11-01

### Added

- `musicman check --fix` repairs what the checks find, after showing every change and asking once: renames
  custom field spellings to one (a configured tag id or a `check.names` entry, else the most used), removes
  custom fields with the same text as the standard frame they duplicate (or moves them into an empty one),
  removes leftover `spotify_track_id` frames, writes multi value fields without empty, padded, or repeated
  items and in their most used casing, and updates the database for drifted files. Each file is rewritten
  once; the run is archived so `musicman undo` restores the tags. `--dry-run` only shows the changes, and
  what needs a decision (two spellings with different values, a differing standard frame, a custom grouping)
  is listed and left alone.
- `check` reports `rare` values: context, mood, and picks values at most `check.rareCount` (3) songs use,
  with a common value one edit away (two from eight letters) as a suggestion.
- `check` reports `exclusive` problems: songs and Spotify tracks in more than one rating or grouping
  playlist (the `sync.playlists` filtering one single value field), saying which playlist the tags call
  for, or which copies of the song disagree.

## [1.40.3] - 2026-11-01

### Changed

- Development tooling only, nothing changes for users: tests run on mocha 12, chai 6, sinon 22, and
  sinon-chai 4, with coverage from c8 instead of nyc; the mocha config is down to the settings used, with no
  retries and a 20 s timeout. One Prettier config at the root formats every package. Commit messages are
  checked against conventional commits by a `commit-msg` hook. The private workspace packages no longer
  carry their own version, and the unused `todos` script is gone.

## [1.40.2] - 2026-11-01

### Removed

- The `server.port` and `websocket.port` options of the removed placeholders; a config that still sets
  them gets an unknown option warning.

### Added

- README section for `musicman ui`.

## [1.40.1] - 2026-11-01

### Fixed

- `musicman ui` only answers its own page. Before, a web page open in the browser could accept or reject
  matches with a plain text POST to 127.0.0.1:6660, and a DNS rebinding site could read the lists and
  stream library files. Requests must now name 127.0.0.1 or localhost at the server's port as their Host,
  and requests that change something must be JSON from the page's own origin.
- The zsh completion test waits for each completion to finish before typing the next line; it failed
  most runs when the keys were typed ahead.

### Removed

- The unused `server/` and `client/` placeholders (a 2019 Express server and React app that no longer
  started). `musicman ui` serves the page from the cli.

## [1.40.0] - 2026-11-01

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

[Unreleased]: https://github.com/njhoffman/musicman/compare/v1.68.0...HEAD
[1.68.0]: https://github.com/njhoffman/musicman/compare/v1.67.0...v1.68.0
[1.67.0]: https://github.com/njhoffman/musicman/compare/v1.66.0...v1.67.0
[1.66.0]: https://github.com/njhoffman/musicman/compare/v1.65.1...v1.66.0
[1.65.1]: https://github.com/njhoffman/musicman/compare/v1.65.0...v1.65.1
[1.65.0]: https://github.com/njhoffman/musicman/compare/v1.64.0...v1.65.0
[1.64.0]: https://github.com/njhoffman/musicman/compare/v1.63.0...v1.64.0
[1.63.0]: https://github.com/njhoffman/musicman/compare/v1.62.1...v1.63.0
[1.62.1]: https://github.com/njhoffman/musicman/compare/v1.62.0...v1.62.1
[1.62.0]: https://github.com/njhoffman/musicman/compare/v1.61.0...v1.62.0
[1.61.0]: https://github.com/njhoffman/musicman/compare/v1.60.0...v1.61.0
[1.60.0]: https://github.com/njhoffman/musicman/compare/v1.59.0...v1.60.0
[1.59.0]: https://github.com/njhoffman/musicman/compare/v1.58.2...v1.59.0
[1.58.2]: https://github.com/njhoffman/musicman/compare/v1.58.1...v1.58.2
[1.58.1]: https://github.com/njhoffman/musicman/compare/v1.58.0...v1.58.1
[1.58.0]: https://github.com/njhoffman/musicman/compare/v1.57.2...v1.58.0
[1.57.2]: https://github.com/njhoffman/musicman/compare/v1.57.1...v1.57.2
[1.57.1]: https://github.com/njhoffman/musicman/compare/v1.57.0...v1.57.1
[1.57.0]: https://github.com/njhoffman/musicman/compare/v1.56.1...v1.57.0
[1.56.1]: https://github.com/njhoffman/musicman/compare/v1.56.0...v1.56.1
[1.56.0]: https://github.com/njhoffman/musicman/compare/v1.55.1...v1.56.0
[1.55.1]: https://github.com/njhoffman/musicman/compare/v1.55.0...v1.55.1
[1.55.0]: https://github.com/njhoffman/musicman/compare/v1.54.0...v1.55.0
[1.54.0]: https://github.com/njhoffman/musicman/compare/v1.53.0...v1.54.0
[1.53.0]: https://github.com/njhoffman/musicman/compare/v1.52.0...v1.53.0
[1.52.0]: https://github.com/njhoffman/musicman/compare/v1.51.0...v1.52.0
[1.51.0]: https://github.com/njhoffman/musicman/compare/v1.50.2...v1.51.0
[1.50.2]: https://github.com/njhoffman/musicman/compare/v1.50.1...v1.50.2
[1.50.1]: https://github.com/njhoffman/musicman/compare/v1.50.0...v1.50.1
[1.50.0]: https://github.com/njhoffman/musicman/compare/v1.49.1...v1.50.0
[1.49.1]: https://github.com/njhoffman/musicman/compare/v1.49.0...v1.49.1
[1.49.0]: https://github.com/njhoffman/musicman/compare/v1.44.0...v1.49.0
[1.44.0]: https://github.com/njhoffman/musicman/compare/v1.43.0...v1.44.0
[1.43.0]: https://github.com/njhoffman/musicman/compare/v1.42.0...v1.43.0
[1.42.0]: https://github.com/njhoffman/musicman/compare/v1.41.1...v1.42.0
[1.41.1]: https://github.com/njhoffman/musicman/compare/v1.41.0...v1.41.1
[1.41.0]: https://github.com/njhoffman/musicman/compare/v1.40.3...v1.41.0
[1.40.3]: https://github.com/njhoffman/musicman/compare/v1.40.2...v1.40.3
[1.40.2]: https://github.com/njhoffman/musicman/compare/v1.40.1...v1.40.2
[1.40.1]: https://github.com/njhoffman/musicman/compare/v1.40.0...v1.40.1
[1.40.0]: https://github.com/njhoffman/musicman/compare/v1.39.0...v1.40.0
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
