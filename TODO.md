# TODO

Tracks known issues, refactoring, and planned features, grouped by area; open items first in each section.
Check items off (`- [x]`) in the commit that resolves them; `/todo` and `/todo-pop` (from `~/.shell`) show
open/done counts and pick items. Every item has a priority, `(p1)` high, `(p2)` normal, or `(p3)` low, and a
category: bug, feature, refactor, docs, test, chore, or perf. `(due YYYY-MM-DD)` adds a date and an OVERDUE
flag. Feature specs live in `docs/`.

Reviewed: 2026-11-26

## 3. Library data

- [x] **Run `check --fix` on the library.** (p2) [chore] 2026-11-01: trial on Bigbeat & Dubstep (97 files,
      `20261101-192452-check`), then the library (5934 files, `20261101-195235-check`); a dry run after finds
      nothing to repair. Left for a decision: 784 cases (613 `Comment` vs COMM, 393 of them where COMM holds
      only iTunNORM; LABEL, AlbumArtist, COMPOSER, ISRC; 4 name groups with differing values).
- [x] **One ReplayGain spelling.** (p3) [chore] uppercase, as beets' mediafile creates new frames (it
      matches existing ones in any case): the `gain` tag id is `TXXX.REPLAYGAIN_TRACK_GAIN` in
      `~/.musicmanrc.yml` (2026-11-01), so `check --fix` renames all four ReplayGain fields to uppercase.
- [x] **Keep sleeve's timed lyrics from beets.** (p2) [bug] beets writes its stale copy of the lyrics with any
      file write (`modify`, `write`, `replaygain`, ...), over the LRC sleeve put in `USLT`. The `keeplrc` beets
      plugin (`cli/share/beets/keeplrc.py`, 2026-11-03) keeps LRC lyrics out of those writes; musicman's own
      writes were checked to keep `USLT` and `SYLT` (`lib/beets/lyrics.spec.js`).
- [x] **Copies of a song in two rating playlists.** (p2) [chore] `check --only=exclusive` (2026-11-01): 82
      songs whose linked files disagree on a rating or grouping playlist (e.g. 311 - Beautiful Disaster on
      Transistor at 5.0 and on Live at 4.5). Push no longer adds such tracks (1.42.0, `Conflict` column), but
      the ones already in two playlists stay there. Decide per song: one rating for both, or unlink the copy
      matched to the wrong recording (often a live file matched to the studio track), then remove the
      track from the playlist it no longer belongs in. Done 2026-11-03: the last 23 songs decided one by one;
      15 duplicate files trashed, 3 wrong recordings unlinked, 31 Spotify changes; the check reports none.
- [ ] **`check --only=exclusive` says "not in the library" for songs it has.** (p3) [bug] a playlist track that is
      another release of a library song (same ISRC) is reported as not in the library: on 2026-11-03 Nas - If I
      Ruled the World, Incubus - Talk Shows on Mute, and Goldfrapp - Ooh La La all have rated files. Name the file
      and its rating, since that decides which playlist the track belongs in.
- [ ] **`sync` can read a playlist as it was just before a change.** (p3) [bug] on 2026-11-03 the first
      `sync --dry-run` after removing tracks through the Web API still showed the old playlists, and the next one
      was right (twice), so a change can miss the refresh, whose unchanged-snapshot check skips the fetch. Find out
      whether `sync --pull` right after a push can act on that, e.g. take a tag off for a stale `-Spotify`.
- [ ] **Rare values found by `check`.** (p3) [chore] mood:Bluesy (2), Dark, Folksy, Groovy (3 each), and
      picks:Jeremy (1) on 2026-11-01; keep, merge, or rename each.
- [x] **`check` duplicates miss copies that share only an ISRC.** (p2) [bug] `Unrated/_Singles/Coldplay -
      Clocks.mp3` and its album copy shared only an ISRC. An ISRC rule (TSRC and `sp_isrc` pooled, other
      recordings left out) finds 65 new groups on the 2026-11-27 library; `_Singles` losers to any Rated
      copy now go to the trash.
- [ ] **Other recordings named only by their release.** (p3) [bug] `otherRecording` reads version words
      from the file name only, so Coldplay `single/2008 - Lost!/03 - Lost@.mp3` (live) and Boards of Canada
      `single/1999 - Peel Session/02 - Happy Cycling.mp3` were taken for copies of their album tracks.
      Since 1.94.0 copies under Artists are never removed, so what is left: a Singles copy of such a
      recording is trashed beside the studio album copy, and the match clearing (rule 1) misses them.
      Folder names are no safe signal (`Live Through This`); maybe the beets `albumtype`/MusicBrainz
      secondary types, or Spotify's own ISRC differing from TSRC. Length does not tell them apart (Lost@
      is 0 s from Lost!). Also `And She Was (early version).mp3`: `early` is not in `versionWords`.
- [ ] **Review the 105 Artists copies let back in.** (p2) [chore] 1.94.0 readmitted the 91 Artists copies
      earlier `check --fix` runs excluded (70 compilation, 15 single release, 6 EP); 1.95.0's
      `check --fix` unrates them (rating moved to the kept copy). The 14 numbered copies with the same
      audio (`Mickey Mouse Operation/*.1.mp3`) stay in the trash. List and plan:
      `~/.cache/musicman-review/`. 26 rated ties under Artists are left to `check --pick`; some are other
      recordings to skip (`Right Where It Belongs V.2`, `Lost@`, the `Acoustic` EP).
- [ ] **Grouping-only playlists include unrated duplicate copies.** (p3) [bug] Copies unrated by
      `check --fix` stay in the library, so local playlists filtered on grouping alone
      (`grouping:IndieRock.Artists`) list a compilation copy beside its album copy. Spotify sync is safe
      (`sync.scope: rating:4`). Add a rating term to those filters, or a scope for local playlists.
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

- [ ] **CLI startup costs over a second before any work.** (p3) [perf] `musicman --version` took 1.1s of CPU and 1.6-2.4s
      of wall time on the installed build (measured under heavy system load, so measure again idle first), so every one-shot use (`player toggle` from a key or bar click, `status`) lags by
      that much. Profile with `node --cpu-prof` and lazy-load the heavy requires in `cli/lib/cli.js`.
- [x] **`check --fix` for duplicates.** (p2) [feature] rules (other recordings cleared, Rated over
      Unrated, file over numbered copies, album > EP > single > compilation), merged multi values and newer
      rating, fzf picks and confirmation, trash with beets removal, undo (file_changes, migration 8), and
      the Duplicates tab of `musicman ui`. 2026-11-02 plan on the library: 271 groups, 183 copies removed,
      47 matches cleared, 47 groups to pick.
- [x] **Live copies keep their studio match.** (p2) [bug] the fix rejected the studio match, but the live
      file's ISRC (beets wrote the studio one) matched the next studio edition, and the plan listed copies
      linked to nothing as "re-match" forever. 1.56.0: live songs only match live tracks, unlinked copies
      leave the group.
- [x] **`match recheck` for live files on studio tracks.** (p3) [feature] Done in 1.59.0 (31 live files on
      studio tracks and 1 the other way on the 2026-11-02 library). matches made before 1.56.0 that
      link a live file to a studio track stay until a duplicates fix clears them; `sync match recheck` only
      compares titles. It could send live/studio disagreements to review too (live folder or album against
      `sp_album`).
- [x] **Manage excluded songs.** (p3) [feature] Done in 1.60.0: `db --excluded` and `db --readmit [path]`
      (CLI only; a page list was left out). songs `check --fix` took out of the library (table
      `excluded_songs`, files kept) can only come back through `musicman undo`. A command or a page list
      to show them and let one back in (e.g. `db --include <path>`) would help once the undo history is
      pruned (`history.keep`).
- [x] **Rating conflicts use the file time.** (p3) [bug] Done in 1.62.0 with `songs.rated_at` (migration 11)
      rather than the undo history, which keeps only 50 runs. `check --fix` gives the kept duplicate the rating of
      the newest copy by mtime, but any tag write (an artwork repair, a sync --match refresh) makes a file
      newer without a new rating. The POPM change times in the undo history (`tag_changes`) would tell when
      each rating was set, for runs still kept (`history.keep`).
- [x] **`check --fix` reads the candidate files a second time.** (p3) [perf] the report reads every file, then
      `planFixes` (`check/fix.js`) reads each candidate again; on a messy library that is most of it. Keeping
      the raw frames of candidates from the first pass (without APIC images) would skip the second read. Done
      differently: the second read takes the tag alone (`readTagRaw`), 7 times faster cold, nothing kept.
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
- [x] **Divider above the status line.** (p3) [feature] draw a dim full width rule above the footer progress line so
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
- [x] **Covers of identified singles.** (p2) [feature] singles kept the default image (`library.defaultCover`,
      1326 files, 914 of them matched) after being matched on Spotify. Done 2026-11-22: `sync --match` and
      review accept embed the Spotify album cover over the default image (or none), marked as from Spotify,
      artwork a file came with is kept; rejecting a linked single puts the default image back; `check --fix`
      does the backlog and gives unmatched singles without a cover the default image; status, notifications
      and the menu show `sp_album` for singles played from MPD. The album tag stays the genre group.
- [ ] **Name the singles albums `<Genre> Singles`.** (p3) [chore] the album tag of singles groups them by genre
      but is named inconsistently: "Handpicked Indie-Rock", "Handpicked Indie Rock", "Indietronica &
      Trip-Hop" (69 files), "Unsorted Singles". Rename to one scheme, e.g. "Pop-Rock Singles", from the
      grouping (`grouping:PopRock.Singles`), with a `check` that reports singles off the scheme and a fix
      that writes it; keep `album:Unsorted Singles` working in the beets path rules or rename it too.
- [ ] **Cover checks read whole mp3 files.** (p2) [perf] `embeddedCover` reads the file in full on each call.
      `embeddedCover` (`cli/lib/metadata/cover.js:60`) gives node-id3 the path, which `readFileSync`s the
      whole mp3 (the problem `readTagBuffer` solved for `readMetadata`, see the Completed "Read only the
      tag" item). The `artwork` check (`cli/lib/check/library.js:457`) calls it, synchronously, for every
      matched single that has a cover. That is every one of the ~914 matched singles, on every `musicman
      check` run, even after the backlog fix, because a Spotify cover still has to be read to tell it from
      the default image. `spotifyCovers` and `rejectReview` (`cli/lib/sync/match.js:201`, `:833`) do the
      same per match. Fix: `NodeId3.read(readTagBuffer(file), { include: ['APIC'] })`, with null for a file
      without a tag.
- [ ] **Generate artwork when none can be found.** (p3) [feature] for singles still without a cover, generate one
      (e.g. artist and title over a color derived from the grouping), clearly marked as generated so a real cover
      can replace it later.

## 7. Spotify sync (`docs/03-spotify-id.md`, `docs/05-spotify-push.md`)

- [x] **Use the Liked Songs playlist view everywhere.** (p2) [feature] `sync.likedPlaylistId` (the playlist the player
      reports while playing Liked Songs) lists local files and follows the app in both directions, tested 2026-11-05.
      Sync's cache and snapshots read it (`fetchLiked` in `cli/lib/sync/cache.js`), so the plan, `sync --export`, status,
      the menu, and the bar heart see local likes; `--confirm` remains only as the fallback without it.
- [x] **Prefer the original album over compilations.** (p2) [feature] `releaseRank` among same-recording candidates
      (own album by name, album, single, compilation, various artists); `sync --match --recheck` looks compilation
      matches up again. Probable album versions are only reported (a review reject would unlink the song).
- [x] **`sync --push` export.** (p2) [feature] `sync --export` (1.57.0): `files/` with every song Spotify lacks
      (for the phone and the desktop app), `stage/` with one playlist's songs to drag at a time, and a
      `README.md` checklist. Tried 2026-11-02: the desktop app lists all sources as one Local Files list and
      a local entry plays from any file with the same tags, so one subfolder per playlist was dropped.
- [x] **Verify pushed local files.** (p2) [feature] each `sync` matches the playlists' local tracks to the
      exported songs (artist, title, length within 2 s): the `Local files` column, the checklist, and the local
      tracks that are none of the songs. Completed songs stay in `files/`, which is what plays them.
- [x] **Desktop playback of local files.** (p2) [chore] the apt `spotify-client` 1.2.63 only loads ffmpeg 4.x
      (`libavcodec.so.54`-`.58`); the system has `.61`. Done 2026-11-02 in `~/.shell` 0.58.0: the spotify
      recipe builds a minimal ffmpeg 4.4.5 into `~/.local/lib/spotify-ffmpeg` and links it into
      `/usr/share/spotify` (the client's RUNPATH is `$ORIGIN`); `spotify.update` keeps it across upgrades.
- [ ] **Try the review listen keys in a real session.** (p3) [test] ctrl-l (mpv), ctrl-s (Spotify), and ctrl-x in the
      `sync --review` list have only run in tests; MPD is not paused while they play.
- [x] **Spotify artist metadata for every credited artist.** (p3) [feature] `fetchDetails` only fetches
      `artists[0]`, so genres, popularity, and photos of featured or second artists are never stored. Decide whether
      the extra artist requests are worth it and how multi value fields would hold them.
- [x] **Spotify audio features.** (p3) [feature] populate acousticness, danceability, energy, instrumentalness,
      key, liveness, loudness, mode, speechiness, tempo, time_signature, valence. Blocked: `/audio-features`
      and `/audio-analysis` return 403 for this app (checked 2026-10-20); needs another source (see section 11).
      Done 2026-11-03: `sync --features` from ReccoBeats by Spotify track id (`lib/sync/features.js`), tempo to
      TBPM, key to TKEY, the rest to `rb_*`; still 403 from Spotify that day.
- [x] **Audio features for the songs ReccoBeats lacks.** (p3) [feature] about 17% of sampled tracks are unknown to
      it, and ~1600 songs have no Spotify id. Analyse the files themselves with Essentia (its music extractor, e.g.
      through the beets xtractor plugin), which also gives mood probabilities (happy, sad, party, relaxed,
      aggressive) for the mood analysis item. Needs the standalone extractor binary and models (beets runs on
      Python 3.14, which Essentia does not support yet), and hours for a first pass. Done 2026-11-03:
      `musicman analyze` (Essentia has Python 3.14 wheels after all, run through `uv`): tempo and key where
      empty, `es_danceability` and five `es_mood_*` probabilities, resumable, about 7 to 9 hours for the library.
- [x] **Analyse in the background while idle.** (p2) [feature] `musicman analyze --idle` and the
      `musicman-analyze.timer` (`just install`, every 15 minutes): starts when the 15 minute load is under 1 and
      on AC power, 2 workers at idle priority, finishes the files in progress and stops on battery or when
      other processes keep the load up (`cli/lib/analyze/idle.js`); a lock keeps manual and background runs apart.
- [ ] **Warn when `analyze.idle.busyLoad` is not above `load`.** (p3) [bug] a background run starts while
      the 15 minute load is under `load`, then stops once other processes keep the 1 minute load over
      `busyLoad` for `busyMinutes`; with `busyLoad` at or below `load` (raising only `load`, as on charon
      2026-11-15) a run can stop itself two minutes after it starts, every 15 minutes. `validateConfig`
      (`common/config/validator.js`) should warn, or `idleSettings` raise `busyLoad` to `load + 1`.
- [ ] **Suggest `mood` values from the Essentia moods.** (p3) [feature] once `analyze` has run, offer `mood` values
      for songs whose `es_mood_*` probabilities are high (e.g. relaxed above 0.8 and no mood yet), to accept in
      the page or a picker, never written on their own.
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
      manifest, undo history), then the rest: 894 imported into `Unrated/_Singles`, every one with the manifest's
      track id. beets takes ~14 s per file, mostly the lyrics plugin. Left: the 367 downloads that failed.
      2026-11-03: spotDL 4.5.2 (yt-dlp 2026.8.19) found no track at all, which explains them; `uv tool upgrade
      spotdl` (4.6.0) downloads again. 175 tracks are queued now: download them (the page's Download, a first N
      trial first) and import them.
- [x] **Second Spotify versions of a library song are pulled again on every sync.** (p2) [bug] the plan
      counts a track with the ISRC of a library song (`sp_isrc`) as that song: not pulled, its playlists
      reach the song as +Spotify, and push does not add the library's release next to it. The playlist
      cache stores ISRCs (migration 7 fetches every playlist again). On the 2026-11-02 library: 201 of
      520 pull tracks dropped, 21 songs gain context/picks tags, 12 grouping/rating decisions listed.
      Matching by artist and title was rejected: it caught live versions, remixes, and remasters.
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
      `musicman ui` starts the script detached since 1.66.0 (`lib/ui/download.js`), which a command could reuse.
- [x] **Stale spotDL temp files.** (p3) [chore] a stopped download leaves the YouTube source it fetched in
      `~/.spotdl/temp` (`.webm`, a few MB each, some from 2024 on 2026-11-03); the download script could delete
      those older than a day before it runs.
- [x] **`sync --pull` manifest.** (p2) [feature] `manifest.json` in `sync.downloadDirectory` with each Spotify-only
      track's URL, targets, and implied tags.
- [x] **spotDL download script.** (p2) [feature] `pnpm download` (in `cli/`); reruns skip downloaded and imported
      tracks.
- [x] **`sync --import`.** (p2) [feature] matches downloads to the manifest by track id, tags them, and imports them
      with beets into `Sorted/Unrated/_Singles`.

## 9. Playback, menu, and shuffle (`docs/07-menu.md`, README "Spotify shuffle")

- [x] **Side trips and `player back`.** (p2) [feature] `player play <terms>` remembers what played
      (`cli/lib/player/back.js`, meta `player.back`), `player back` restores it: MPD queue, modes,
      song and time; Spotify context or shuffle playlist at the track; chained side trips return to the main list.
- [x] **Menu key for `player back`.** (p2) [feature] the rofi menu has no way back from a side trip; add a
      button (`b`, next to reshuffle in `cli/lib/menu/menu.js` modes), disabled without a back point.
- [ ] **Menu: queue tag presses, redraw at once.** (p3) [perf] after the playlist snapshot fix (2026-11-15)
      a press still waits for the tag write, the Spotify push (two requests) and a beets move, about 0.5 to 1
      second. Draw the change from memory at once and run each press (still its own undo run) from a queue
      kept in `~/.local/state/musicman/menu-queue.jsonl` until done, so a killed menu loses nothing (the next
      menu or the notify daemon runs what is left); the menu process stays until the queue is empty, and
      failures and notices come as notifications. Decide after using the snapshot fix for a while.
- [ ] **Try side trips, `player back` and smart playlists live.** (p2) [test] side trips, `back` (CLI and
      the menu's `b`), `--main`/`--shuffle`, `--files -` and `musicman smart` have run only against fakes, and
      fzx 0.116.0 builds on them: one side trip and back on MPD, one on Spotify (with someone listening, see
      the Connect drop-outs), `smart save` and `smart NAME --shuffle`, a menu tag press on a playlist tag
      (should be about a second now, `~/.local/state/musicman/logs/*-menu.json`).
- [ ] **Return from a side trip when it ends.** (p3) [feature] `player back` is manual; the notify daemon
      could restore the back point when the side trip's last song finishes (MPD stops at the end of the
      queue, a Spotify list runs out), like `shuffleHandoff` continues a shuffle. Opt-in, `player.backWhenDone`.
- [x] **fzx: `player play --shuffle` and `--main`.** (p2) [feature] `player play` plays search results in
      library order; `--shuffle` randomizes them (MPD and Spotify alike, without `musicman shuffle`, which is
      Spotify only), and `--main` plays them as a new main list: no back point saved, the old one forgotten.
      The fzx music:smart mode plays presets with both (`~/git/fzx/TODO.md`, "music: smart playlists").
- [x] **fzx: smart playlist presets (`musicman smart`).** (p2) [feature] named filter sets in
      `~/.config/musicman/smart.yml` (name: terms), written by musicman and editable by hand: `smart --list`
      (NAME TERMS SONGS SPOTIFY, `--format tsv|json`), `smart show NAME [--limit N]` (the songs),
      `smart save NAME TERMS...` (validated as filters), `smart rm NAME`, and `smart NAME` plays it
      (`player play` rules). zsh completion of the names; the rofi menu could list them too.
- [x] **fzx: `player back --peek`.** (p3) [feature] prints the back point (source, artist, title, saved at;
      `--format json`) without restoring it, exit 1 when there is none, for the fzx header and status bars.
- [x] **fzx: `player play --files -` and `add --files -`.** (p2) [feature] play (or add) exact files instead
      of search terms: paths relative to the MPD music dir, one per line on stdin, in the given order, with the
      same back-point rules as `play <terms>` (`--main`, `--shuffle` apply too). fzx's library modes (artists,
      albums, stored playlists, picked songs) hold exact values, and `field:value` matches substrings
      (`albumartist:Yes` also takes "Yesterday's"; stored playlists and picked songs have no term form), so
      their side trips need files. MPD only (`player mpd play --files -`); with `spotify`, or when the
      current player is Spotify without `mpd`, refuse with a message rather than look the files up on Spotify.
      Unknown paths: skip them with a warning, exit 1 only when none are left.
- [x] **fzx: back point published to a runtime file.** (p2) [feature] the fzx header shows the back point in
      every music mode and redraws on each reload; starting the CLI (over a second, "CLI startup") for each
      is too slow. Write the back point to `$XDG_RUNTIME_DIR/musicman/back` (the `--peek` fields, one per
      line or JSON) whenever `player play` saves one, and remove the file when `player back` restores it or
      `--main`/`musicman shuffle` forgets it, as the notify daemon publishes `now-playing`. fzx reads the
      file directly (absent: no back point) and falls back to `--peek` only when the file's directory is
      missing; `player back --peek --path` prints the path so fzx does not hardcode it.
- [x] **fzx: `smart --format tsv` is refused before smart runs.** (p1) [bug] `musicman smart --format tsv`
      (and `smart show NAME --format tsv`) fails with "Unknown format 'tsv', use one of: default, oneline,
      csv, json, html": `cli/lib/cli.js:70` calls `outputFormat()` (`cli/lib/output/formats.js`, no `tsv`) on
      every command's switches to decide whether logs go to stderr, so the global list rejects a format only
      `smart` knows. smart.spec.js calls the command directly and misses it; an integration test through
      `cli.js` would catch it. Fix: let the stderr check accept any non-default `--format` (or add `tsv` to
      the list and refuse it in the commands that do not print it). The fzx music:smart mode reads tsv.
- [x] **Now playing line for status bars.** (p2) [feature] the notify daemon publishes a Polybar line (player icon,
      Liked Songs heart, library star, time left) to `$XDG_RUNTIME_DIR/musicman/now-playing`
      (`cli/lib/notify/barPublisher.js`, `cli/lib/status/bar.js`); the `now-playing` Polybar module replaces the separate
      MPD and Spotify segments.
- [x] **Menu: Spotify local files are not recognized.** (p2) [feature] a local file playing in Spotify (desktop
      app or phone) has no track id (`https://open.spotify.com/local/<artist>/<album>/<title>/<seconds>` over MPRIS,
      `is_local` without an id in the Web API), so the menu shows nothing playing and no song buttons. Match the
      URL's artist, title, and length to a library song, as `isLocalTrackOf` does for the export. Done:
      `libraryFileForPlaying` (`lib/player/library.js`), used by the menu, `status`, and the notifications.
- [x] **Menu: control Spotify on other devices.** (p3) [feature] `spotifyConnectPlayer` (Web API) when neither the
      desktop app nor MPD plays. With the desktop app open, it mirrors the phone over MPRIS and playerctl
      controls it (tested 2026-11-03), so the Web API player covers the app being closed.
- [x] **Keep playing past the first 1000 shuffled tracks.** (p3) [feature] `musicman shuffle` starts at most 1000
      tracks as a list (a rewritten playlist plays its previous order for a minute or more), so playback stops after
      them although the playlist holds the rest. Options: start the playlist at track 1001 once the list ends
      (needs a watcher), or queue the next tracks from the notify daemon. Done: the daemon queues the next
      track as the last listed one starts, then moves playback to the playlist there (`notify/shuffleHandoff.js`).
      It follows Spotify through MPRIS, so only while the desktop app runs (also when it mirrors the phone).
- [ ] **See a shuffle continue past its list.** (p3) [test] the daemon's handoff (queue the next track, then move to
      the playlist) has run only in specs. Set `shuffle.listSize` to 3 or so (1.77.0), shuffle, and listen past
      the third track, once with the desktop app and once on the phone with the app closed
      (`journalctl --user -u musicman-notify` logs a failure).
- [x] **Continue shuffles played on the phone alone.** (p3) [feature] the handoff follows Spotify through MPRIS, so
      it needs the desktop app running (it mirrors the phone); with the app closed the shuffle stops after its
      list. Done: the daemon asks `GET /me/player` every 30 seconds while a shuffle waits for its handoff and
      the desktop app plays nothing (`pollHandoff` in `notify/shuffleHandoff.js`); no calls otherwise.
- [x] **Menu: unbound letters filter the main menu unseen.** (p3) [bug] Cannot reproduce, 2026-11-02: on rofi
      2.0.0 a theme whose `inputbar` has no `entry` drops typed text, so `f`, `z`, ... filter nothing on the main
      menu (tested with xdotool). Binding the free keys is not possible anyway: the main menu fills all 19
      `kb-custom` slots; rebinding them to a no-op action (`kb-toggle-case-sensitivity`) would work if needed.
- [x] **Menu details: copy a line.** (p3) [feature] Enter on a line of the details screen (`i`) copies its value
      (the Spotify link, the file path) with `wl-copy` or `xclip`, then goes back.
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
- [x] **Song notifications use the player as app-name.** (p2) [bug] `buildNotification`
      (`cli/lib/notify/notification.js`) sends `--app-name=${notice.source}`, the player name (`MPD` or
      `Spotify`, `cli/lib/player/players.js`), so the deadd rule for `musicman` never matches and deadd's
      `Spotify` rule (timeout 3000) shortens song notifications. Send `--app-name=musicman` and put the
      player in a hint (`--hint=string:x-musicman-player:mpd`) or the category (`x-musicman.song`), so
      notification daemon rules (deadd today, notifyd next) can match songs. Also drop or relax the explicit
      `--expire-time` (`daemon.duration`) so the daemon's per-app timeout decides.
- [x] **Menu: grouping buttons.** (p3) [feature] `menu.buttons` only takes one value of a multi value field
      (context, mood, picks); grouping is single valued, so setting it would need a picker submenu.
- [x] **Menu: redraw when the song changes.** (p3) [feature] the menu shows the song as it was when drawn; a song that
      ends while it is open stays shown until the next press. rofi has no timer, so this would need closing and
      reopening it from a player event (MPD idle, MPRIS PropertiesChanged).
- [x] **Lyrics.** (p3) [feature] fetch lyrics for the playing song (embedded USLT first, then an online source) and
      show them like Spotify's mini player, scrolling along with the playback position when the lyrics are synced
      (LRC). Moved to sleeve (`~/ghq/github.com/njhoffman/sleeve`), which reads the playing song itself and
      finds library files for Spotify tracks through musicman's contract (docs/09-contract.md, 1.55.0).
- [x] **`musicman shuffle` and Spotify shuffle and repeat.** (p2) [feature] 1.31.0: a source in uniformly random
      order written to one reused playlist and started as a track list through the Web API; `musicman spotify`
      and the menu's `u`, `r`, and `o` buttons. Spotify keeps API-created playlists public (documented in the
      README).
- [x] **Like or ignore the Spotify song that is playing.** (p2) [feature] `musicman menu` likes Spotify songs not in
      the library and adds them to `sync.ignorePlaylist`.
- [x] **rofi menu for the playing song.** (p2) [feature] `musicman menu`: playback controls for MPD and Spotify,
      tag and rating buttons from `menu.buttons` and `menu.ratings`.

## 11. Research and other services

- [ ] **Smart playlists on Spotify.** (p3) [feature] generate playlists from the library's own metadata (context,
      mood, picks, rating, grouping, Spotify genres and popularity) instead of only fixed filters, and push them like
      the mapped playlists. First look into services or libraries that build better smart playlists from that kind
      of metadata.
- [ ] **Mood analysis services.** (p3) [feature] evaluate APIs that tag songs with moods (to fill or suggest the
      `mood` tag and replace the blocked Spotify audio features): bridge.audio, SonoTeller, Cyanite.ai, Musiio, AIMS
      API. Compare coverage, price, whether they analyze uploaded audio or only catalogue ids, and rate limits.
- [ ] **Lyrics analysis and sources.** (p3) [feature] lyric based tags (themes, explicitness, language). Fetching
      lyrics belongs to sleeve, which has LRCLIB and NetEase; build on its lyrics (`sleeve lyrics --json`) rather
      than evaluating sources again here.
- [ ] **Genre analysis services.** (p3) [feature] evaluate Every Noise at Once, Chosic music genre finder, PitchPlus,
      and SubmitHub "What's my genre" for finer genres than Spotify's artist genres, to help guess groupings.
      Several are websites without an API, so check what can be automated.
- [ ] **Other music services.** (p3) [feature] support services besides Spotify (e.g. YouTube Music, SoundCloud) for
      matching, playlist sync, and playback, starting with which ones have a usable API.

## 12. Tooling

- [x] **`pnpm release` commits every change in the work tree.** (p2) [chore] `.versionrc.json` has
      `"commitAll": true`, so a release takes in what another session is still editing (on 2026-11-15 the
      Soloist work, its CHANGELOG entry included; 1.88.0 and 1.89.0 were released by hand to keep it out).
      Done 2026-11-21, not as first planned: `commitAll` commits the index only (`git commit` without paths),
      and turning it off would drop CHANGELOG.md from the commit. The leaks were the shared [Unreleased]
      section and staged files: the release now takes HEAD's [Unreleased] entries, keeps uncommitted ones
      under [Unreleased] in the working copy, and refuses to run while anything is staged.
- [ ] **Test the systemd units `just install` writes.** (p3) [test] the `musicman-notify` service and the
      `musicman-analyze` service and timer are printf lines in the Justfile with no test; a typo shows only
      when systemd refuses them. Run `systemd-analyze --user verify` on them in `install-check`, or write them
      from a script with a spec.
- [ ] **Drop the `profile` script.** (p3) [chore] `cli/package.json`'s `profile` runs `ndb`, which is not
      installed; `node --cpu-prof lib/cli.js` (or `--prof`) does the same without it.
- [ ] **Remove `common/config/musicrater.service`.** (p3) [chore] a leftover systemd template from the old
      name (`ExecStart=/var/www/myapp/app.js`, user nobody); nothing uses it, the units come from `just install`.
- [ ] **cli dev scripts run repo code on the live database.** (p2) [chore] `pnpm dev`, `start`, `start:stats`.
      `cli/package.json` lines 6-8 (`nodemon ... lib/cli.js`, `node lib/cli.js`, `node lib/cli.js stats`)
      load `~/.musicmanrc.yml` (`loadConfig` has no other path), so `db.path` is opened from the working tree.
      On a branch with a new migration that migrates the live database and breaks the installed build.
      `cli/CLAUDE.md` lists `pnpm start` as a command right above its rule against exactly this. Nothing
      in `openDatabase` (`cli/lib/db/database.js:78`) guards it. Fix: drop the three scripts, plus `nodemon`
      and `cli/nodemon.json` (whose `ignore: src` names a folder that does not exist). Or point them at a
      sandbox config, which needs a config path override (e.g. `MUSICMAN_CONFIG`) in
      `common/config/index.js`.
- [ ] **Two installers write `musicman-notify.service`.** (p3) [refactor] `just install` and `pnpm
      daemon:install` each have their own copy of the unit text. `just install` writes the unit with
      `printf` and `command -v node`, then restarts the service. `cli/scripts/install-daemon.js` writes the
      same unit through `unitText`, picks the node with `stableNode` (which skips pnpm store paths), and is
      the only one that writes `~/.config/musicman/spotify.env`. `docs/07-menu.md` and the README describe
      only `daemon:install`. Each run of `just install` overwrites the unit without the store check, and
      new credentials need the other command. Fix: have the Justfile call the script, or move all three
      units into the script; the latter also covers "Test the systemd units" above, since `unitText` has a
      spec (`cli/lib/notify/installDaemon.spec.js`).
- [ ] **Stale `cli/CHANGELOG.md` and `common`'s test script.** (p3) [chore] leftovers from before the
      workspace setup. `cli/CHANGELOG.md` is a tracked standard-version stub (1.1.1 and 1.2.0, 2025-07-27);
      `pnpm release` only writes the root one. `cli/CLAUDE.md` line 4 ("history in `CHANGELOG.md`"), read
      from `cli/`, points at the stub. `common/package.json`'s `test` is the npm placeholder (`echo "Error:
      no test specified" && exit 1`), so `pnpm -r test` fails even though the root `test` only runs the
      cli filter (common's specs live in `cli/lib/config/` and `cli/test/unit/config.js`). Delete the
      stub, and drop the script or point it at those specs.
- [ ] **`defaultConfig.yml`: split comment and unused `library.basePath`.** (p3) [chore] two config defects.
      The `hostSync` block (added in 239a1a0) went in between the two halves of the `analyze` comment
      (`common/config/defaultConfig.yml:194-201`). The `analyze` text now stops at "Each worker is a
      process of its own", and the `hostSync` block starts with an orphaned "keeping the library the same
      on several computers". Separately, `library.basePath: "/home/nicholas/Music"` (line 363, schema in
      `validator.js:205`) is read nowhere; `mpd.baseDirectory` is the library root. Fix the comments and
      drop `basePath` (a warning for user configs that still set it).
- [ ] **Docs index, outline, and database schema lag the code.** (p3) [docs] three docs are out of date.
      The README Documentation table stops at `docs/09-contract.md` and leaves out
      `docs/10-host-sync.md`. The `docs/01-outline.md` layout has no `lib/analyze/`, `lib/smart/`,
      `lib/config/` (the config specs) or `scripts/essentia-analyze.py`, and gives `share/` as only the
      rofi theme (`share/beets/keeplrc.py` is there too). `docs/02-database.md` "Schema" lists 5 of the 15
      tables (none of `spotify_matches`, `spotify_playlists`, `tag_changes`, `history_runs`,
      `excluded_songs`, ...), and its "Prerequisites" and "Database initialization" sections are planning
      notes from 2026-10-20 ("any other tables that make sense adding?").
- [x] **Specs that stub stdout swallow their own TAP lines.** (p3) [test] 10 tests missing from
      test-progress. `cli/lib/commands/edit.spec.js` (7 tests) and the paging tests in
      `cli/lib/commands/logs.spec.js:105-112` (3) replace `process.stdout.write` in `beforeEach` and restore
      it in `afterEach`. Mocha writes a test's result line before `afterEach` runs, so under
      `--reporter tap` the stub captures it. test-progress then counts them as "not run" (1394 of 1404
      on 2026-11-27). Fix: restore inside each test (try/finally, as `logs.spec.js:84-91` does), or stub
      only around the call under test.

## 15. Host sync (`docs/10-host-sync.md`)

Charon and minerva both keep the full library; a change log in S3 keeps them the same. In build order.

- [x] **Audio hash per song.** (p2) [feature] `songs.audio_hash` (migration), SHA-256 of the audio without
      the ID3v2 and ID3v1 tags, filled by `db --update` for new and changed files; a hash index. The identity
      every entry uses (paths change on moves); also lets `check` find true duplicates.
- [x] **Change log written by every change.** (p2) [feature] a `changes` table (id, at, song hash and hints,
      kind, field, value, previous, pushed) filled from `journaledWrite`, `journaledMatch`, `recordFileMove`
      and import (`cli/lib/history/journal.js`), so nothing that edits can skip it; undo writes the entries
      that restore old values. Useful with one host too: a full history of every tag change.
      Done 2026-11-15 for tag edits (by library field) and match decisions; imports and removed
      duplicates are logged with "Imports travel through S3".
- [x] **S3 bucket and credentials.** (p2) [chore] check the AWS plan (`aws freetier get-account-plan-state`;
      the free plan's S3 tier is 5 GB), a private versioned bucket in the selected Region, an IAM policy
      scoped to it, a `musicman-sync` profile on both hosts.
      Done 2026-11-21 on charon (paid plan): bucket `musicman-sync` in us-east-2, IAM user `musicman-sync`;
      minerva's profile is copied with "Set up minerva".
- [ ] **`sync --hosts`: pull, apply, push.** (p2) [feature] the `log/<host>/` batches and `hosts/<host>.json`
      position (doc "S3 layout"), applying entries through the edit path as a `sync --hosts` run, conflicts as
      in the doc (newest wins per field, multi value adds and removes merge, pending entries for unknown
      songs), `--status`, `--dry-run`, `--init`; the `hostSync` config block.
- [ ] **Imports travel through S3.** (p2) [feature] import uploads each new song's audio as
      `audio/<hash>.mp3` and writes an `add` entry; applying one downloads and imports it like `sync --import`.
      `hostSync.audio: lan` instead leaves it to `--fetch <host>` over the LAN.
- [ ] **`sync --push` pulls first.** (p2) [feature] with `hostSync` set, a Spotify push runs a host pull
      first and refuses when it fails (`--force`), so a host never pushes playlists without the other's ratings.
- [ ] **Daemon runs host sync.** (p3) [feature] the notify daemon runs `sync --hosts` at start and every
      `hostSync.interval`, and `musicman db` shows unpushed entries and the last pull.
- [ ] **Compact the change log once every host has an entry.** (p3) [perf] `changes` is never pruned; the
      background analyze alone adds about 10 entries per song (some 70,000 for the library). Once push and
      pull exist, entries every host has applied (by `hosts/<host>.json` positions) can be dropped or folded
      into the latest value per song and field, keeping a recent window for history.
- [ ] **Set up minerva.** (p2) [chore] copy the `musicman-sync` profile (`~/.aws/credentials` and
      `~/.aws/config`) from charon, rsync the library over the LAN, copy charon's database once on the same
      build (matches and history come along), `sync --hosts --init` on both; then rate a song on each and
      check both hosts end up with both ratings.

## Completed

### 1. Bugs (completed 2026-11-03)

- [x] **Unknown fields in filters are ignored silently.** (p3) [bug] `parseFilters`
      (`cli/lib/parser/options/filters.js`) skips a `field:value` whose field is not a configured tag, so a typo in
      `stats.filters` or `sync.playlists` matches every song. Now a config error (`filterProblems` in
      `common/config/validator.js`, also for `menu.buttons`), and refused on the command line except by `search`
      and `player`, which take such a term as text.
- [x] **Unknown fields in assignments are ignored silently.** (p3) [bug] `musicman edit contxt=Study` writes nothing
      and says nothing (`parseAssignments` skips fields that are not library tags); refused like filters now.
- [x] **Memory use when reading many files.** (p3) [bug] `stats --files` peaked at 3.2 GB on 7363 files: node-id3
      reads each whole file and gives the UFID identifier as a slice of it, which kept every mp3 in memory.
      `toRawTags` copies buffers out; 726 MB on 2026-11-03.
- [x] **Read only the tag when reading files.** (p3) [perf] `readMetadata` (`metadata/read.js`) gives node-id3 the
      path, so it reads each whole mp3 (2m19s for `stats --files`); reading the tag alone (`readTagBuffer`, as
      `check --fix` does now) was 7 times faster cold with the same frames. Done: `readTagBufferAsync`
      (`metadata/tagBuffer.js`), same frames for all 7363 files; `stats --files` 2m19s to 34s.
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

### 2. Code quality (completed 2026-11-03)

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

### 6. Database (`docs/02-database.md`) (completed 2026-11-15)

- [x] **Back up before a schema migration.** (p2) [feature] opening the database migrates it, and the interval of
      the automatic backups can skip right over a migration: on 2026-11-03 the newest copy (2026-11-02 01:12) is
      schema 5 while the database is schema 11, so restoring it loses every change since. Done: `openDatabase`
      writes `musicman-before-schema-<n>.sqlite` next to the backups first, and does not migrate without it.
- [x] **Backups.** (p2) [feature] the database is backed up to `db.backupDirectory` every `db.backupInterval`
      (before writes, `db --backup` on demand, `db.backupCount` kept).
- [x] **`search` command.** (p2) [feature] field syntax (`rating:5.0 title:"some title"`) and mpc style
      (`rating 5.0 title "some title"`); free text searches title and artist; exact matches on multi-value fields.
- [x] **`search --add` and `--play`.** (p2) [feature] append results to the MPD queue, or replace it and play.
- [x] **Faster `search`.** (p2) [perf] a SQL prefilter narrows candidates, about 200-500ms instead of 1-2s.
- [x] **Log file.** (p2) [feature] `logger.file.name` at `logger.file.level`; per-file `db --update` actions go to
      the log only.
- [x] **Database tests and error handling.** (p2) [test] for backups, `search`, and the database-backed commands.

### 10. Undo, history, and backups (completed 2026-11-03)

- [x] **Prune `.musicman-removed` on the backup.** (p3) [feature] `sync --backup` moves files deleted from the library
      there and never deletes them (folders since 2026-10-21); keep the last N dated folders, as
      `backup.keepReplaced` does for `.musicman-replaced`, or report its size so it can be cleared by hand.
- [x] **Follow moved songs without a MusicBrainz id in the undo history.** (p3) [feature] `db --update` relinks a
      moved song (and its history) only by MusicBrainz track id; 1622 of 6454 songs (2026-11-01) have none, so
      their moves read as a removal plus an addition and undo reports them missing. A fallback key such as
      `sp_track_id`, or duration plus artist and title for songs with a single match, would cover most. Done:
      `findMoved` (`db/update.js`) falls back to both, each only when one song matches.
- [x] **Follow moved files in the undo history.** (p2) [feature] `relinkHistory` (`history/relink.js`) from the
      `db --update` move branch and after `sync --import` (download path to library path by `sp_track_id`).
- [x] **Keep replaced files in `sync --backup`.** (p2) [feature] move the backup copy of an updated file to
      `.musicman-removed/<date>/` (or a versions folder) before overwriting it, like deleted files, so a bad tag
      write that reached the backup can still be recovered. Done: `.musicman-replaced/<run time>/`, the last
      `backup.keepReplaced` runs (2) kept.
- [x] **Undo the frames that did not change since.** (p3) [feature] `planUndo` (`cli/lib/history/undo.js`)
      already compares per frame, but one changed frame marks the whole file `changed`, so undo restores none of
      it without `--force`, and `--force` restores the changed frames too. E.g. 2026-11-01: undo of
      `20261027-005126-edit` (`context=-Relax`) was refused because that write also normalized `TXXX.Mood`
      (dropped a trailing comma) and a later edit changed Mood again. Restore the unchanged frames (Context
      here), skip and list the changed ones, and keep `--force` for those. Done, also in the History tab.
- [x] **Restore the database from a backup.** (p3) [feature] `db --restore [<backup>]` to list and restore the
      automatic database backups. Done, named copies (`musicman-*.sqlite`) included; the current database is
      saved first.
- [x] **Record `check --fix` changes.** (p3) [feature] once `check --fix` exists it writes through
      `lib/metadata/write.js` and is recorded automatically; make sure its run archives (the `archive` flag) so
      `undo` covers it. Checked 2026-11-03: it archives with `--fix` and writes through `journaledWrite`; a spec
      undoes a fix run.
- [x] **Tag change journal and `undo`.** (p1) [feature] `tag_changes` (schema 5) through `lib/history/journal.js`;
      `musicman undo [<run> | --list] [--dry-run] [--force]`.
- [x] **Spotify change journal and undo.** (p1) [feature] `spotify_changes` and the snapshot before each push;
      undo puts removed tracks back at their old position.
- [x] **`sync --backup`.** (p1) [feature] mirrors the library to `/mnt/nfs/Music`, confirming first, deletions
      opt-in, refusing to overwrite a backup file whose tag has frames the library copy lacks.
- [x] **Progress feedback for `sync --backup`.** (p2) [feature] status line while comparing, bytes with rate and
      ETA while copying (1.27.0).

### 12. Tooling (completed 2026-11-03)

- [x] **Format the files Prettier flags.** (p3) [chore] `pnpm format:check` lists 15 files (e.g.
      `commands/db.js`, `commands/sync.js`, `sync/plan.js`, `sync/localFiles.js`, `docs/*.md`) written before
      the `.prettierrc` reflow, so every change to them has to leave the rest alone. One `pnpm format` commit,
      then a check in the pre-commit hook (staged files only) keeps it clean.
- [x] **The notify daemon runs node from the pnpm store.** (p3) [bug] `pnpm daemon:install` writes `process.execPath`
      into the unit, a versioned store path (`.../pnpm/store/v11/links/@/node/24.22.0/...`); a node upgrade or a
      store prune removes it and the service fails to start. Resolve a stable node path at install (the pnpm
      `node` shim on PATH) or check it in `musicman status`.
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

### 13. Housekeeping (completed 2026-11-03)

- [x] **Remove stale tracked files.** (p3) [chore] `cli/test_output.txt`, `cli/test_output2.txt`,
      `cli/SESSION_SUMMARY.md`, and `cli/CONTEXT.md` (superseded by the root `CONTEXT.md`); `docs/scratch.md` holds
      early notes on `library.tags` that the config now implements.
- [x] **Placeholder `server/` and `client/`.** (p3) [chore] removed with their `server.port` and `websocket.port`
      options; `musicman ui` serves the page from the cli.
- [x] **Refresh the developer docs.** (p3) [docs] `cli/CLAUDE.md` lists the commands as view, edit, playlist, stats,
      quotes 91 passing tests and nyc coverage, and ends with a stale "Current Session Context"; root `CONTEXT.md`
      says commits use gitmoji; `docs/01-outline.md` shows a 2020 layout without `db/`, `sync/`, `spotify/`,
      `menu/`, or `history/`. Done 2026-11-03: `cli/CLAUDE.md` rewritten, root `CONTEXT.md` removed (its lasting
      notes moved to `cli/CLAUDE.md`), `docs/01-outline.md` holds the current layout and points at the README.
- [x] **Delete the local `install.sh`.** (p3) [chore] an untracked copy of the nvm installer, ignored by a
      `.gitignore` entry of its own; delete the file and that entry.
- [x] **Remove the untracked repo copy of `.musicmanrc.yml`.** (p3) [chore] it was identical to
      `~/.musicmanrc.yml`, which dotbare tracks; deleted 2026-11-01 and ignored in `.gitignore`.

### 14. Management page (`musicman ui`, `cli/lib/ui/`) (completed 2026-11-03)

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
- [x] **Import from the page.** (p3) [feature] after a download, `sync --import` still runs in a terminal; an
      Import button could run it the way Download runs the download script (a detached run, its output shown).
- [x] **Trial downloads from the page.** (p3) [feature] Download fetches every queued track; `pnpm download
      --limit N` has no counterpart there.
- [x] **Run downloads from the page.** (p3) [feature] Download and Cancel in the Spotify to local tab run the
      download script detached (`lib/ui/download.js`); each download is a `download` run, so the page and a
      terminal never download at once.
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
