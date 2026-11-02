# TODO

Tracks known issues, refactoring, and planned features, grouped by area; open items first in each section.
Check items off (`- [x]`) in the commit that resolves them; `/todo` and `/todo-pop` (from `~/.shell`) show
open/done counts and pick items. Every item has a priority, `(p1)` high, `(p2)` normal, or `(p3)` low, and a
category: bug, feature, refactor, docs, test, chore, or perf. `(due YYYY-MM-DD)` adds a date and an OVERDUE
flag. Feature specs live in `docs/`.

Reviewed: 2026-11-01

## 1. Bugs

- [ ] **Unknown fields in filters are ignored silently.** (p3) [bug] `parseFilters`
      (`cli/lib/parser/options/filters.js`) skips a `field:value` whose field is not a configured tag, so a typo in
      `stats.filters` or `sync.playlists` matches every song. Validate configured filters at load time and warn.
- [ ] **Memory use when reading many files.** (p3) [bug] an old comment in `getFilteredFiles`
      (`cli/lib/commands/common.js`) reported memory overflow reading the whole library from disk. Check peak memory
      of `stats --files` on the full library; reading in batches (as `db/update.js` does) would bound it.
- [x] **`-i`/`--include` and `-x`/`--exclude` do nothing.** (p2) [bug] Stale: checked 2026-11-01, `view` applies
      them to the table, the single file list, and `--format` columns (`commands/view.js`, `songColumns`).
- [x] **MPD responses cut values at the second colon.** (p2) [bug] `common/mpd/utils.js` `parseMpdReply` splits on
      the first `: ` only, shared by the client and the menu.
- [x] **`stats.filters` is never used.** (p3) [bug] `stats` shows a Filters section; the defaults no longer filter on
      a `type` tag that does not exist.
- [x] **`--include=`, `--exclude=` and `--write=` are not parsed.** (p2) [bug] they now have a `value` key.
- [x] **Rating ranges compared as strings.** (p2) [bug] `filterRating` compares numbers, so `rating:4-4` matches.
- [x] **`edit` asks for confirmation before checking for zero matches.** (p3) [bug] zero matches return first.
- [x] **Playlist paths use string replace.** (p2) [bug] `commands/playlist.js` uses `path.relative`.
- [x] **`term-size` spawns `resize`.** (p3) [bug] replaced by `process.stdout.columns` with a fallback.
- [x] **`pnpm lint` fails with 103 errors.** (p2) [bug] fixed by the ESLint migration.
- [x] **Logging levels use different scales.** (p3) [bug] `output.verbosity` and `logger.file.level` take level
      names; the unused `logger.stdout.level` was removed.
- [x] **Logger ignores `logger.colors`.** (p3) [bug] terminal lines start with a level badge in the level's colors.

## 2. Code quality

- [x] **Combine `filterInclude` and `filterExclude`.** (p3) [refactor] one `matchesFilters` negates the test of each
      value, so a multi value exclude still means none of the values is present.
- [x] **Skip the MPD lookup for commands without targets.** (p3) [perf] `cli/lib/cli.js` asks MPD for the playing
      song before parsing every command, so `shuffle`, `spotify`, `sync`, `logs`, and `undo` wait for it too, up to
      the 2 s connect timeout when MPD is down. Done: commands with `targetArgs: false` skip it.
- [x] **Make the notify daemon testable.** (p3) [refactor] `lib/notify/notification.js` builds and sends
      notifications; `notify-daemon.js` only loads config.
- [x] **Rename `seperators` to `separators`.** (p3) [refactor] with a legacy-key error.
- [x] **Replace `bluebird`.** (p3) [refactor] native promises and `utils/promise.js` `mapLimit`.
- [x] **Replace `prompt-confirm`.** (p3) [refactor] `utils/confirm.js` on `@inquirer/confirm`.
- [x] **Vendored MPD client.** (p3) [refactor] evaluated 2026-10-31 and kept: `mpd2` adds a fixed ~100 ms idle check
      to every connect (175 ms vs 53 ms here), which `menu` pays per command, and it renames reply keys.
- [x] **Move TODO comments out of the code.** (p3) [chore] moved into this file.
- [x] **`library.tagId` is not used.** (p3) [chore] removed; musicman stays on ID3v2.3 (beets `id3v23: true`,
      node-id3). Revisit v2.4 only together with beets `id3v23: false` and a v2.4-capable writer.

## 3. Library data

- [x] **Run `check --fix` on the library.** (p2) [chore] 2026-11-01: trial on Bigbeat & Dubstep (97 files,
      `20261101-192452-check`), then the library (5934 files, `20261101-195235-check`); a dry run after finds
      nothing to repair. Left for a decision: 784 cases (613 `Comment` vs COMM, 393 of them where COMM holds
      only iTunNORM; LABEL, AlbumArtist, COMPOSER, ISRC; 4 name groups with differing values).
- [x] **One ReplayGain spelling.** (p3) [chore] uppercase, as beets' mediafile creates new frames (it
      matches existing ones in any case): the `gain` tag id is `TXXX.REPLAYGAIN_TRACK_GAIN` in
      `~/.musicmanrc.yml` (2026-11-01), so `check --fix` renames all four ReplayGain fields to uppercase.
- [ ] **Copies of a song in two rating playlists.** (p2) [chore] `check --only=exclusive` (2026-11-01): 82
      songs whose linked files disagree on a rating or grouping playlist (e.g. 311 - Beautiful Disaster on
      Transistor at 5.0 and on Live at 4.5). Push no longer adds such tracks (1.42.0, `Conflict` column), but
      the ones already in two playlists stay there. Decide per song: one rating for both, or unlink the copy
      matched to the wrong recording (often a live file matched to the studio track), then remove the
      track from the playlist it no longer belongs in.
- [ ] **Rare values found by `check`.** (p3) [chore] mood:Bluesy (2), Dark, Folksy, Groovy (3 each), and
      picks:Jeremy (1) on 2026-11-01; keep, merge, or rename each.
- [x] **`check --fix`.** (p2) [feature] `musicman check --fix` (docs/08-check.md): names, standard,
      spotify-id, multi, case, and drift, after one confirmation, recorded for `musicman undo`.
- [x] **Clean up duplicate TXXX fields.** (p2) [chore] `check --fix` renames each name to its most used
      spelling (the configured tag id or a `check.names` entry first); running it is the item above.
- [ ] **Unmapped and empty grouping playlists.** (p2) [chore] `grouping:Dubstep.Singles` (34 songs rated 4.5+)
      has no `sync.playlists` entry, while `Ambient.Artists`, `ElectronicFunk.Artists`, and
      `ContemporaryInstrumental` have entries but few or no songs in scope, so their playlists push empty.
- [x] **`check` command (report).** (p2) [feature] `musicman check` reports every planned check without
      changing anything (`docs/08-check.md`); repairs are the open `check --fix` item.
- [x] **Clean up context and mood values.** (p2) [chore] fixed `mood:Ubpeat`, moved values between context, mood,
      and picks, removed `mood:Dirt`, renamed `mood:Very Mellow` to `Placid`.

## 4. Command line and output

- [ ] **`check --fix` reads the candidate files a second time.** (p3) [perf] the report reads every file, then
      `planFixes` (`check/fix.js`) reads each candidate again; on a messy library that is most of it. Keeping
      the raw frames of candidates from the first pass (without APIC images) would skip the second read.
- [x] **Progress bar and colored output for `check`.** (p2) [feature] `progressBar` with ETA per phase; report
      and plan colored like the sync plan (`output/check.js`).
- [x] **Complete tag values and run ids in zsh.** (p3) [feature] node needed 0.35-1.9 s per Tab, so the script
      reads values with the `sqlite3` command (about 20 ms) and globs the runs directory, both paths fixed at
      generation like the field names.
- [x] **Complete `spotify` and `shuffle` arguments in zsh.** (p3) [feature] `spotify` declares its setting
      `pairs`; `shuffle` completes `liked`, the cached `spotify_playlists` names, and filters.
- [x] **Unquoted `~field:` exclusions do not complete in zsh.** (p3) [feature] the script is `#compdef musicman
      -tilde-`: fields for musicman, `_tilde` for other commands. Another plugin binding `-tilde-` later wins.
- [ ] **Smarter terminal fitting.** (p3) [feature] for the table view: shrink the widest columns instead of dropping
      the rightmost ones.
- [ ] **List headers and table row separators.** (p3) [feature] honor `views.list.headers.visible` (the list view
      ignores it; the table view honors `views.table.headers.visible`) and implement
      `views.table.separators.horizontal`, or remove both options.
- [ ] **Divider above the status line.** (p3) [feature] draw a dim full width rule above the footer progress line so
      it stands apart from the log lines scrolling above it (redrawn with the footer, cut to the terminal width).
- [x] **Now playing screen.** (p2) [feature] `musicman status` (and bare `musicman` while a player plays or is
      paused): Nerd Font icons, a progress bar, the library fields, and for Spotify the cached playlists holding the
      track; `--watch` redraws it, `--format json` for status bars.
- [x] **`status` command.** (p2) [feature] the active player and its modes, the song with its rating and tags, and
      where it plays from: the MPD queue position, or the Spotify context from `GET /me/player`.
- [ ] **`status --watch` misses tag changes until the track changes.** (p3) [feature] watch mode reads a song's tags
      and Spotify context once per track, so a rating set from the menu while it is open shows on the next track.
      Re-read them when the file's mtime changes, or every few seconds.
- [x] **Show the playing track list of `musicman shuffle` in status.** (p3) [feature] `shuffle` stores its order
      (meta `shuffle.order`); status shows `shuffle "<source>"` for a track in it played without a context, or
      when the shuffle playlist plays.
- [x] **Duration and size in `stats`.** (p3) [feature] checked 2026-11-01: `total_duration` and `total_size` are
      filled from the database and from `--files` reads alike (20 min, 21 MB for `Rap-R&B/Singles` both ways), so
      no switch is needed.

## 5. Artwork

- [x] **Fetch missing artwork for singles.** (p2) [feature] `check` `artwork`: `check --fix` embeds the Spotify album
      cover (every song without one, not only singles). beets fetchart cannot cover singletons, so songs not on
      Spotify stay left for you.
- [ ] **Generate artwork when none can be found.** (p3) [feature] for singles still without a cover, generate one
      (e.g. artist and title over a color derived from the grouping), clearly marked as generated so a real cover
      can replace it later.

## 6. Database (`docs/02-database.md`)

- [x] **Backups.** (p2) [feature] the database is backed up to `db.backupDirectory` every `db.backupInterval`
      (before writes, `db --backup` on demand, `db.backupCount` kept).
- [x] **`search` command.** (p2) [feature] field syntax (`rating:5.0 title:"some title"`) and mpc style
      (`rating 5.0 title "some title"`); free text searches title and artist; exact matches on multi-value fields.
- [x] **`search --add` and `--play`.** (p2) [feature] append results to the MPD queue, or replace it and play.
- [x] **Faster `search`.** (p2) [perf] a SQL prefilter narrows candidates, about 200-500ms instead of 1-2s.
- [x] **Log file.** (p2) [feature] `logger.file.name` at `logger.file.level`; per-file `db --update` actions go to
      the log only.
- [x] **Database tests and error handling.** (p2) [test] for backups, `search`, and the database-backed commands.

## 7. Spotify sync (`docs/03-spotify-id.md`, `docs/05-spotify-push.md`)

- [x] **Prefer the original album over compilations.** (p2) [feature] `releaseRank` among same-recording candidates
      (own album by name, album, single, compilation, various artists); `sync --match --recheck` looks compilation
      matches up again. Probable album versions are only reported (a review reject would unlink the song).
- [ ] **`sync --push` export.** (p2) [feature] (also the action of the `musicman ui` local to Spotify list) export songs missing from Spotify to `sync.uploadDirectory`, one
      subfolder per target playlist (hardlinks when possible), with a `README.md` checklist and printed summary.
      Verify first how Spotify desktop Local Files sources handle subfolders.
- [ ] **Verify pushed local files.** (p2) [feature] on `sync`, read local tracks in the mapped playlists, report
      songs still missing, and remove completed ones from the export directory.
- [ ] **Try the review listen keys in a real session.** (p3) [test] ctrl-l (mpv), ctrl-s (Spotify), and ctrl-x in the
      `sync --review` list have only run in tests; MPD is not paused while they play.
- [ ] **Spotify artist metadata for every credited artist.** (p3) [feature] `fetchDetails` only fetches
      `artists[0]`, so genres, popularity, and photos of featured or second artists are never stored. Decide whether
      the extra artist requests are worth it and how multi value fields would hold them.
- [ ] **Spotify audio features.** (p3) [feature] populate acousticness, danceability, energy, instrumentalness,
      key, liveness, loudness, mode, speechiness, tempo, time_signature, valence. Blocked: `/audio-features`
      and `/audio-analysis` return 403 for this app (checked 2026-10-20); needs another source (see section 11).
- [x] **Spotify credentials.** (p1) [feature] from the environment or `spotify.*`; `sync --login` saves OAuth tokens
      to `$XDG_STATE_HOME/musicman/spotify-token.json` (mode 0600).
- [x] **Sync config.** (p1) [feature] `sync.likedRating`, `sync.playlists`, `sync.uploadDirectory`,
      `sync.downloadDirectory`, `sync.spotdlCommand`, `sync.beetsConfig`.
- [x] **`sync` command and cache.** (p1) [feature] refreshes Liked Songs and mapped playlists (unchanged snapshots
      skipped) and reports songs to add, songs without a Spotify id, tracks to prune, and tracks to pull.
- [x] **Spotify track ids.** (p1) [feature] `sync --match`: beets ids, then ISRC, then scored artist/title search.
- [x] **Spotify fields.** (p2) [feature] `sync --match` writes the `spotify.fields` mapping as `TXXX.sp_*` tags.
- [x] **Liked Songs.** (p1) [feature] `sync --push` saves songs rated at least `sync.likedRating`.
- [x] **Grouping playlists.** (p1) [feature] `sync --push` adds songs matching each `sync.playlists` filter; adds were
      verified by the push of 2026-10-21, removes by the prune test of 2026-11-01.
- [x] **Pull Spotify-side changes to songs already in the library.** (p1) [feature] three way plan with
      `spotify_synced`; `sync --pull` applies filter tag changes made on Spotify.
- [x] **Verify `sync --push` against Spotify.** (p2) [test] 7757 tracks added on 2026-10-21.
- [x] **Verify `sync --push --prune` and its undo.** (p2) [test] 2026-11-01: a deliberate `edit context=-Relax`
      pruned one track from Relax (position 58) after the snapshot, and `musicman undo` of the push put it back at
      position 58.
- [x] **Duplicate files sharing a Spotify id show up as prune.** (p1) [bug] a track is extra only when no copy of
      its song belongs.
- [x] **Multi value writes stored `undefined`.** (p1) [bug] `writeFiles` joins arrays with commas.
- [x] **Restore playlist tags lost on 2026-10-21.** (p1) [bug] restored from the database backup of 2026-10-20
      (run `20261026-174457-repair`).
- [x] **Run `sync --pull` for the repaired tags.** (p1) [chore] done 2026-10-26.
- [x] **Decide the 9 Spotify changes `sync --pull` left.** (p2) [chore] done 2026-10-26.
- [x] **Stricter Spotify version matching.** (p2) [bug] matches need the same title and suffix words.
- [x] **Recheck existing matches and review with accept and reject.** (p1) [feature] `sync --match --recheck`,
      `sync --review --accept` / `--reject`.
- [x] **Match similarity percent.** (p2) [feature] `matchSimilarity`, written as `TXXX.sp_diff_percent`.
- [x] **Auto-accept close matches.** (p2) [feature] `sync.autoAcceptPercent`.
- [x] **Live recordings score as studio matches.** (p1) [bug] live albums now count as a version marker.
- [x] **Changed numbers in a title cost more similarity.** (p2) [bug] -10 per differing number (1.27.0).
- [x] **Icon for linked in the review list.** (p3) [feature] nerd font link icon and a unicode arrow.
- [x] **Listen to both versions in review.** (p3) [feature] ctrl-l, ctrl-s, ctrl-x in the review list.
- [x] **Spotify artist metadata on tracks.** (p2) [feature] popularity, followers, genres, and photo of the first
      artist; photos cached in `spotify.artistImageDirectory`.
- [x] **Spotify album metadata on tracks.** (p2) [feature] `sp_album_popularity` and `sp_album_image`.

## 8. Downloads and import (`docs/04-spotify-pull.md`, `docs/06-spotify-sync-runbook.md`)

- [ ] **Verify `sync --pull`, `pnpm download`, and `sync --import` end to end.** (p2) [test] 2026-11-02: 1281 pulled,
      904 downloaded (367 missing, rerun `pnpm download`), a 20 file slice imported and checked (tags, database,
      manifest, undo history); 884 left to import. beets takes ~14 s per file, mostly the lyrics plugin.
- [ ] **`import` command wrapping beets.** (p2) [feature] one command for newly downloaded files, reading the beets
      config (paths, import settings) so it tags and renames like beets would:
      - tell full albums from singles (album import vs `-s` singletons) and import each the right way
      - for spotDL downloads, add the tags of every playlist the track is in (a song in several playlists gets all
        their tags, multi value fields collect every value) plus all the `spotify.fields`
      - files that did not come from Spotify go through the `sync --match` lookup (beets id, ISRC, search) first
      - supersedes `sync --import`, which only handles manifest downloads as singletons
- [ ] **Guess the grouping of downloads.** (p2) [feature] for each track handed to spotDL, guess its grouping (genre)
      from the library: groupings of the same artist's songs first, then songs whose Spotify artist genres overlap.
      Record the guess (and why) in the manifest and download into a folder named after it, but never write it to
      the grouping tag, whose presence marks a song as organized and rated.
- [ ] **Assign the guessed grouping once a song is rated.** (p2) [feature] check whether beets can route imports into
      `Unrated` by the absence of a rating instead of the absence of a grouping (a path query on a rating field, e.g.
      through the types or mpdstats plugin). If it can, write the guessed grouping on import and let the rating
      decide the folder; otherwise keep the guess out of the tag.
- [ ] **`download` command.** (p2) [feature] search Spotify for artists and albums, pick results (fzf), add them to
      the manifest, fetch them with spotDL (see the next item), and import them (the `import` command above), with
      the grouping guess.
- [ ] **`download --missing`.** (p2) [feature] scan the library for albums of wanted artists that are not in it and
      suggest them. An artist with their own folder (`.../Artists/<artist>/`) means their full catalogue is wanted.
      Cache the Spotify discographies so the check is quick, and say at the start of the command how much is
      missing, e.g. "notice: 28 albums across 15 artists are not imported yet".
- [ ] **Revisit running spotDL from musicman.** (p3) [feature] downloads run as a separate script (`pnpm download`)
      because they are long, resumable, and against YouTube's terms. Decide whether the `download` command should
      start spotDL itself; if it does, keep it resumable and keep the manifest as the record of what to fetch.
- [x] **`sync --pull` manifest.** (p2) [feature] `manifest.json` in `sync.downloadDirectory` with each Spotify-only
      track's URL, targets, and implied tags.
- [x] **spotDL download script.** (p2) [feature] `pnpm download` (in `cli/`); reruns skip downloaded and imported
      tracks.
- [x] **`sync --import`.** (p2) [feature] matches downloads to the manifest by track id, tags them, and imports them
      with beets into `Sorted/Unrated/_Singles`.

## 9. Playback, menu, and shuffle (`docs/07-menu.md`, README "Spotify shuffle")

- [ ] **Menu: control Spotify on other devices.** (p3) [feature] menu playback goes through MPRIS, so only the
      desktop app; the Web API player endpoints (scopes granted since 1.31.0) would cover the phone and speakers.
- [ ] **Keep playing past the first 1000 shuffled tracks.** (p3) [feature] `musicman shuffle` starts at most 1000
      tracks as a list (a rewritten playlist plays its previous order for a minute or more), so playback stops after
      them although the playlist holds the rest. Options: start the playlist at track 1001 once the list ends
      (needs a watcher), or queue the next tracks from the notify daemon.
- [ ] **Menu: unbound letters filter the main menu unseen.** (p3) [bug] the main menu has no filter box, but rofi
      still filters on keys no button takes (`f`, `z`, ...), so a stray press can hide buttons until Backspace.
      Bind the free letters to nothing (`-kb-custom-N` to a no-op key) or show the filter there too.
- [ ] **Menu details: copy a line.** (p3) [feature] Enter on a line of the details screen (`i`) could copy its value
      (the Spotify link, the file path) with `xclip`/`wl-copy` instead of going back.
- [x] **Playback controls for MPD and Spotify.** (p2) [feature] one set of mpc style commands (play, pause, next,
      previous, seek, volume, queue) that acts on whichever player is active, plus musicman features such as playing
      a search result or a filter. `musicman spotify` covers shuffle and repeat; the Web API player scopes are
      granted now, and `shuffle`'s device choice (`playDevice` in `lib/commands/shuffle.js`) can be reused.
- [x] **Own song change notifications.** (p2) [feature] replace the mpDris2 notifications (unreliable now) by extending
      `lib/notify/notification.js`: show the source (Spotify or MPD), the rating when there is one, context and mood
      labels, and the album cover; watch Spotify through MPRIS PropertiesChanged as well as MPD.
- [x] **Menu: details, genre, and tags submenus.** (p2) [feature] the details screen (`i`), the grouping button
      renamed genre, and a tags submenu (`e`) of every picks, context, and mood value replace the tag buttons on the
      main screen; `menu.tagFields`, `menu.tagMinSongs`, and `menu.extraTags` configure it. Opens on next, seek 30s,
      no player switch, new look.
- [x] **Reshuffle the playing playlist.** (p3) [feature] the menu's reshuffle button repeats the last
      `musicman shuffle` source, because MPRIS does not say which playlist is playing. `GET /me/player` gives the
      context (`user-read-playback-state` is granted), so it could shuffle what is playing instead.
- [x] **Menu: MPD random and repeat.** (p3) [feature] the menu's shuffle and repeat buttons are disabled for MPD; MPD
      has `random`, `repeat`, and `single`, so `mpdPlayer` (`cli/lib/menu/players.js`) could offer the same shuffle
      and repeat functions and report them from `status`.
- [x] **Menu: Liked Songs state comes from the cache.** (p3) [bug] the like button of a Spotify song not in the
      library is highlighted from the cached Liked Songs, refreshed by sync runs; a song liked in the app since shows
      as not liked until then, and undo of a second press would remove it. One `GET /me/library/contains` (or
      `/me/tracks/contains`) request per drawn song would make it current.
- [x] **Menu: grouping buttons.** (p3) [feature] `menu.buttons` only takes one value of a multi value field
      (context, mood, picks); grouping is single valued, so setting it would need a picker submenu.
- [x] **Menu: redraw when the song changes.** (p3) [feature] the menu shows the song as it was when drawn; a song that
      ends while it is open stays shown until the next press. rofi has no timer, so this would need closing and
      reopening it from a player event (MPD idle, MPRIS PropertiesChanged).
- [ ] **Lyrics.** (p3) [feature] fetch lyrics for the playing song (embedded USLT first, then an online source) and
      show them like Spotify's mini player, scrolling along with the playback position when the lyrics are synced
      (LRC).
- [x] **`musicman shuffle` and Spotify shuffle and repeat.** (p2) [feature] 1.31.0: a source in uniformly random
      order written to one reused playlist and started as a track list through the Web API; `musicman spotify`
      and the menu's `u`, `r`, and `o` buttons. Spotify keeps API-created playlists public (documented in the
      README).
- [x] **Like or ignore the Spotify song that is playing.** (p2) [feature] `musicman menu` likes Spotify songs not in
      the library and adds them to `sync.ignorePlaylist`.
- [x] **rofi menu for the playing song.** (p2) [feature] `musicman menu`: playback controls for MPD and Spotify,
      tag and rating buttons from `menu.buttons` and `menu.ratings`.

## 10. Undo, history, and backups

Runs record their tag and Spotify changes for `musicman undo` (since 1.24.0). Still missing: `sync --backup` moves
files deleted from the library to `.musicman-removed/<date>/` but overwrites changed ones, and the automatic
database backups (`db.autoBackup`) have no restore command.

- [ ] **Follow moved songs without a MusicBrainz id in the undo history.** (p3) [feature] `db --update` relinks a
      moved song (and its history) only by MusicBrainz track id; 1622 of 6454 songs (2026-11-01) have none, so
      their moves read as a removal plus an addition and undo reports them missing. A fallback key such as
      `sp_track_id`, or duration plus artist and title for songs with a single match, would cover most.
- [x] **Follow moved files in the undo history.** (p2) [feature] `relinkHistory` (`history/relink.js`) from the
      `db --update` move branch and after `sync --import` (download path to library path by `sp_track_id`).
- [ ] **Keep replaced files in `sync --backup`.** (p2) [feature] move the backup copy of an updated file to
      `.musicman-removed/<date>/` (or a versions folder) before overwriting it, like deleted files, so a bad tag
      write that reached the backup can still be recovered.
- [ ] **Undo the frames that did not change since.** (p3) [feature] `planUndo` (`cli/lib/history/undo.js`)
      already compares per frame, but one changed frame marks the whole file `changed`, so undo restores none of
      it without `--force`, and `--force` restores the changed frames too. E.g. 2026-11-01: undo of
      `20261027-005126-edit` (`context=-Relax`) was refused because that write also normalized `TXXX.Mood`
      (dropped a trailing comma) and a later edit changed Mood again. Restore the unchanged frames (Context
      here), skip and list the changed ones, and keep `--force` for those.
- [ ] **Restore the database from a backup.** (p3) [feature] `db --restore [<backup>]` to list and restore the
      automatic database backups.
- [ ] **Record `check --fix` changes.** (p3) [feature] once `check --fix` exists it writes through
      `lib/metadata/write.js` and is recorded automatically; make sure its run archives (the `archive` flag) so
      `undo` covers it.
- [x] **Tag change journal and `undo`.** (p1) [feature] `tag_changes` (schema 5) through `lib/history/journal.js`;
      `musicman undo [<run> | --list] [--dry-run] [--force]`.
- [x] **Spotify change journal and undo.** (p1) [feature] `spotify_changes` and the snapshot before each push;
      undo puts removed tracks back at their old position.
- [x] **`sync --backup`.** (p1) [feature] mirrors the library to `/mnt/nfs/Music`, confirming first, deletions
      opt-in, refusing to overwrite a backup file whose tag has frames the library copy lacks.
- [x] **Progress feedback for `sync --backup`.** (p2) [feature] status line while comparing, bytes with rate and
      ETA while copying (1.27.0).

## 11. Research and other services

- [ ] **Smart playlists on Spotify.** (p3) [feature] generate playlists from the library's own metadata (context,
      mood, picks, rating, grouping, Spotify genres and popularity) instead of only fixed filters, and push them like
      the mapped playlists. First look into services or libraries that build better smart playlists from that kind
      of metadata.
- [ ] **Mood analysis services.** (p3) [feature] evaluate APIs that tag songs with moods (to fill or suggest the
      `mood` tag and replace the blocked Spotify audio features): bridge.audio, SonoTeller, Cyanite.ai, Musiio, AIMS
      API. Compare coverage, price, whether they analyze uploaded audio or only catalogue ids, and rate limits.
- [ ] **Lyrics analysis and sources.** (p3) [feature] evaluate Musixmatch Pro, lyricsgenius (Genius), and
      LRCLIB/lrcget (synced LRC lyrics, free and offline friendly) as sources for the Lyrics item and for lyric based
      tags (themes, explicitness, language).
- [ ] **Genre analysis services.** (p3) [feature] evaluate Every Noise at Once, Chosic music genre finder, PitchPlus,
      and SubmitHub "What's my genre" for finer genres than Spotify's artist genres, to help guess groupings.
      Several are websites without an API, so check what can be automated.
- [ ] **Other music services.** (p3) [feature] support services besides Spotify (e.g. YouTube Music, SoundCloud) for
      matching, playlist sync, and playback, starting with which ones have a usable API.

## 12. Tooling

- [x] **Test tooling.** (p3) [chore] mocha 12, chai 6 and sinon-chai 4 (ES modules through `require(esm)`), sinon 22,
      and c8 (`.c8rc.json`); `.mocharc.yml` keeps the settings used, with `retries: 0` and a 20 s timeout.
- [x] **Package versions.** (p3) [chore] `cli` and `common` dropped their `version` and are marked private; only
      the root version is released.
- [x] **Commit hooks.** (p3) [chore] `.husky/commit-msg` runs commitlint with `@commitlint/config-conventional`
      (gitmoji removed); headers over 72 characters warn, `subject-case` is off for names like Spotify.
- [x] **Prettier config at the root.** (p3) [chore] `.prettierrc` at the root replaces those of `cli` and `common`
      (120 columns, reflowed to 100); `pnpm format` covers `scripts/`.
- [x] **`todos` script.** (p3) [chore] removed with `leasot`.
- [x] **Stray `vnull` tag.** (p3) [chore] deleted locally and on the remote (it pointed at 25cadb8).
- [x] **ESLint migration.** (p2) [chore] ESLint 10 flat config, `eslint-config-prettier`, Prettier 3 separately.
- [x] **Release tooling.** (p3) [chore] `pnpm release` runs `commit-and-tag-version` (`.versionrc.json`).
- [x] **CHANGELOG.md format.** (p3) [docs] Keep a Changelog, written by hand under `[Unreleased]`;
      `scripts/release-changelog.js` moves the entries into the new version's section.
- [x] **Tests for `utils/logger.js` verbosity levels and padding.** (p3) [test] `logger.spec.js` covers verbosity,
      the padding in `availableWidth`, the status line, the log file, and level badges.
- [x] **Tests for the notify daemon's notification arguments.** (p3) [test] `lib/notify/notification.spec.js`.

## 13. Housekeeping

- [ ] **Remove stale tracked files.** (p3) [chore] `cli/test_output.txt`, `cli/test_output2.txt`,
      `cli/SESSION_SUMMARY.md`, and `cli/CONTEXT.md` (superseded by the root `CONTEXT.md`); `docs/scratch.md` holds
      early notes on `library.tags` that the config now implements.
- [x] **Placeholder `server/` and `client/`.** (p3) [chore] removed with their `server.port` and `websocket.port`
      options; `musicman ui` serves the page from the cli.
- [ ] **Refresh the developer docs.** (p3) [docs] `cli/CLAUDE.md` lists the commands as view, edit, playlist, stats,
      quotes 91 passing tests and nyc coverage, and ends with a stale "Current Session Context"; root `CONTEXT.md`
      says commits use gitmoji; `docs/01-outline.md` shows a 2020 layout without `db/`, `sync/`, `spotify/`,
      `menu/`, or `history/`. Bring them in line with the code, or point them at the README.
- [ ] **Delete the local `install.sh`.** (p3) [chore] an untracked copy of the nvm installer, ignored by a
      `.gitignore` entry of its own; delete the file and that entry.
- [x] **Remove the untracked repo copy of `.musicmanrc.yml`.** (p3) [chore] it was identical to
      `~/.musicmanrc.yml`, which dotbare tracks; deleted 2026-11-01 and ignored in `.gitignore`.

## 14. Management page (`musicman ui`, `cli/lib/ui/`)

- [x] **Cross-site requests can change the library.** (p1) [bug] `checkOrigin` in `cli/lib/ui/server.js`: the
      Host must be 127.0.0.1 or localhost at the server's port, and POSTs must be JSON from the page's origin.
- [x] **Warn while another run changes the library.** (p2) [feature] accepting during `sync --match` or `--pull`
      writes the same files and rows; show a banner (and ask before acting) while a run in the runs directory is
      `running`, which `listRuns` already reports.
- [x] **Reload the lists.** (p2) [feature] the page loads each list once; a `sync` in a terminal leaves it stale
      until the browser reloads. Add a reload button per list, or poll a cheap change marker (the newest
      `spotify_matches.checked_at`, `reviewed_at`, and playlist `synced_at`).
- [x] **Match a song by hand.** (p2) [feature] 865 songs are `missing` (no candidate found). Search Spotify from
      the page for a song, play the results, and accept one, the same accept as for a review candidate; also offer
      other candidates for a review song whose candidate is wrong.
- [x] **Keyboard review.** (p2) [feature] j/k or arrows to move through the list, space to play the local file,
      a and r to accept or reject and move on; with 26 to review and 774 accepted to audit, mouse only review is
      slow.
- [x] **Play the Spotify version from the keyboard.** (p3) [feature] `s` was left out of keyboard review: the
      embedded player is a cross-origin iframe the page cannot start, and "Play in Spotify app" is untried
      against the real app (below). Needs the Web Playback SDK (full playback item) or that test first.
- [x] **Sort the lists.** (p3) [feature] by similarity (least similar first to audit accepted matches), length
      difference, path, or when accepted; columns are fixed in the order the API returns.
- [x] **Transfer actions.** (p2) [feature] Spotify to local shows each track's download state, adds picked
      tracks to the download manifest, and refreshes the cached playlists. The upload export waits for `sync --push`
      export (section 7), tracked there.
- [ ] **Run downloads from the page.** (p3) [feature] `pnpm download` still runs in a terminal; running spotDL
      from the page needs a background job with progress and cancel, and must not run beside a terminal download.
- [x] **Cache the transfer lists.** (p3) [perf] each load reads the library and computes the sync plan, about 5 s;
      the server keeps the result until the transfers change marker changes; Reload asks for it fresh.
- [x] **Undo from the page.** (p3) [feature] the History tab lists the `ui` runs with what undoing each puts back
      and undoes one; undo now also restores the Spotify match rows review changed (`match_changes`).
- [x] **Full Spotify playback in the page.** (p3) [feature] Play here and `s` use the Web Playback SDK
      (1.47.0). Checked live 2026-11-01 in Google Chrome: the page became the Connect device "musicman ui",
      played and paused the track, and left Connect when the tab closed. Chromium builds without Widevine get
      an initialization error, and `s` then plays in the desktop app.
- [x] **Try "Play in Spotify app".** (p3) [test] tried 2026-11-01 against the desktop app: the page's
      `/api/spotify/open` started the track through MPRIS, and the app stayed on Spotify Connect.
- [x] **Tests for the page script.** (p3) [test] `lib/ui/app.spec.js` loads the page in jsdom with a fake
      `fetch`: tabs, keyboard review, sorting, filter, reload, and the runs banner.
- [x] **Page semantics.** (p3) [feature] the tabs are buttons without `tablist` roles and the rows are focusable
      table rows; use a tablist and announce the selected song for screen readers.
