# TODO

Tracks known issues, refactoring, and planned features. Check items off (`- [x]`) in the commit that
resolves them; `/todo` and `/todo-pop` (from `~/.shell`) show open/done counts and pick items. Tag an item
`(p1)` (high) or `(p3)` (low); untagged items are `p2` (normal). `(due YYYY-MM-DD)` adds a date and an
OVERDUE flag. Feature specs live in `docs/`.

## Bugs

- [x] **`pnpm lint` fails with 103 errors.** Fixed by the ESLint migration.
- [x] **`term-size` spawns `resize`**, which prints `resize: can't open terminal /dev/tty` outside a TTY
      (visible in test output). Use `process.stdout.columns` with a fallback and drop the dependency.
- [x] **Playlist paths use string replace.** `commands/playlist.js` strips `mpd.baseDirectory` with
      `String.replace`, which matches anywhere in the path. Use `path.relative`.
- [x] **`edit` asks for confirmation before checking for zero matches** (p3): zero matches now report and
      return before a prompt is built; the prompt is only created when editing several files.
- [ ] **`stats.filters` is never used.** (p3) [bug] The predefined filter sets in config ("All Songs > 4.0", ...) are
      validated but `commands/stats.js` does not compute them.
- [x] **Logging levels use different scales.** `output.verbosity` (default `info`) and `logger.file.level`
      (default `debug`) now take level names (error, warn, info, debug, trace); the unused
      `logger.stdout.level` was removed.
- [x] **Logger ignores `logger.colors`.** (p3) Terminal log lines now start with a level badge colored with
      the level's `fg`, `bg`, and `gui`; the log file is unchanged.
- [ ] **Make the notify daemon testable.** (p3) [refactor] `notify-daemon.js` runs on require; split notification building
      and sending from the MPD loop so `sendNotification` can be unit tested.
- [ ] **Rename `seperators` to `separators`** (p3) [refactor] in `views.table`, with a legacy-key error like the other
      migrated options.
- [ ] **Replace `bluebird`** (p3) [refactor] with native promises (`Promise.map` concurrency via a small helper).
- [ ] **Replace `prompt-confirm`** (p3) [refactor] (unmaintained since 2017) with `@inquirer/confirm`.
- [ ] **Vendored MPD client.** (p3) [refactor] `common/mpd/MpdClient` is a local copy; evaluate a maintained client
      (e.g. `mpd-api`) instead of forking it.
- [ ] **Move existing TODO comments here and remove them from code:** (p3) [chore] combine include/exclude filters (`metadata/filter.js`), memory overflow when
      reading many files (`commands/common.js`), duration/size option for stats (`commands/stats.js`),
      zero-match handling in edit (`commands/edit.js`).

- [ ] **`library.tagId` is not used.** (p3) [chore] Decided to stay on ID3v2.3 (all sampled files, beets `id3v23: true`,
      and node-id3 all use v2.3); `year` now maps to `TYER`. `library.tagId` is set to `ID3v2.3` but nothing
      reads it. Either use it to pick v2.3/v2.4 frames for date tags or remove it. Revisit v2.4 only together
      with beets `id3v23: false` and a v2.4-capable writer.
- [ ] **Clean up duplicate TXXX fields.** (p2) [chore] `stats` shows case and spelling variants of the same field
      (`Comment`/`COMMENT`, `ALBUMARTISTS`/`ALBUM_ARTISTS`, `ARTISTS`/`Artists`) from different taggers.
      Decide which to keep and consolidate them, possibly through beets.

## Tooling

- [x] **ESLint migration:** ESLint 10 flat config (`eslint.config.js` at the root) with `@eslint/js`
      recommended, `eslint-plugin-n`, and `eslint-config-prettier`; Prettier 3 runs separately
      (`pnpm format`, `pnpm format:check`); airbnb, babel, eslint-watch, and the unused `common` ESLint
      dependencies removed.
- [ ] **Test tooling:** (p3) [chore] mocha 12, chai 6, sinon 22, sinon-chai 4, nyc to c8. Clean up
      `.mocharc.yml` (it is the full example config with placeholder values).
- [ ] **Release tooling:** (p3) [chore] `standard-version` is deprecated; switch to `commit-and-tag-version`.
- [ ] **Commit hooks:** (p3) [chore] `husky` and `commitlint` are installed but not configured (no `.husky/`, no
      commitlint config). Either set them up or remove them. Decide between gitmoji and plain conventional
      commits; both configs are installed.
- [ ] **`todos` script** (p3) [chore] points `leasot` at `.js` files and `server/`; update or remove.
- [ ] **`cli/package.json` version is stale.** (p3) [chore] It says 1.2.0 while releases bump only the root
      `package.json` (1.13.0, shown by `musicman --version`). Remove the field or have releases bump it.
- [ ] **Versioning:** (p3) [chore] root is 1.4.x, `cli` is 1.2.0, `common` is 1.0.0. Decide whether packages are versioned
      independently or with the root.

## Testing

- [ ] (p3) [test] Tests for `utils/logger.js` verbosity levels and padding.
- [ ] (p3) [test] Tests for `notify-daemon` notification arguments after the refactor above.

## Features

- [ ] **Smarter terminal fitting** (p3) [feature] for the table view: shrink the widest columns instead of dropping the
      rightmost ones.
- [ ] (p3) [feature] Honor `views.list.headers.visible` (currently ignored) and implement `views.table.seperators.horizontal`
      or remove it.
- [ ] **Divider above the status line:** (p3) [feature] draw a dim full width rule above the footer progress line so it
      stands apart from the log lines scrolling above it (redrawn with the footer, cut to the terminal width).
- [ ] **Fetch missing artwork for singles:** (p2) [feature] find songs tagged as singles without an embedded cover (no
      APIC frame) and embed one: the Spotify album image (from `sp_album_id`) first, then beets fetchart sources. Report
      what was found and from where; `--dry-run` to preview. Decide whether this is its own command or part of `check
      --fix`.
- [ ] **Generate artwork when none can be found:** (p3) [feature] for singles still without a cover, generate one (e.g.
      artist and title over a color derived from the grouping), clearly marked as generated so a real cover can replace
      it later.
- [ ] **Revisit running spotDL from musicman:** (p3) [feature] downloads run as a separate script (`pnpm download`)
      because they are long, resumable, and against YouTube's terms. Decide whether the planned `download` command
      should start spotDL itself; if it does, keep it resumable and keep the manifest as the record of what to fetch.

## Database (`docs/02-database.md`)

- [x] **Backups:** back up the database to `db.backupDirectory` every `db.backupInterval` (before writes,
      `db --backup` on demand, `db.backupCount` kept).
- [x] **`search` command:** field syntax as used here (`rating:5.0 title:"some title"`) and mpc style
      (`rating 5.0 title "some title"`); free text searches title and artist; exact matches on multi-value
      fields.
- [x] **`search --add` and `--play`:** append results to the playlist, or create a new playlist from the
      results and play it.
- [x] **Faster `search`:** a SQL prefilter narrows candidates (superset of the JavaScript filters), about
      200-500ms instead of 1-2s on 6,445 songs with identical results.
- [x] **Log file:** `logger.file.name` (default `musicman.log` in `mpd.baseDirectory`) at `logger.file.level`
      (default 5 = debug); per-file `db --update` actions go to the log only.
- [x] **Database tests and error handling** for backups, `search`, and the database-backed commands.

## Spotify sync (`docs/03-spotify-id.md`)

- [x] **Spotify credentials:** `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` (or `_URL`)
      from the environment, falling back to `spotify.*` in the config; `sync --login` saves OAuth tokens to
      `$XDG_STATE_HOME/musicman/spotify-token.json` (mode 0600).
- [x] **Sync config:** (p1) `sync.likedRating`, `sync.playlists` (filter to playlist, your 38 mappings
      moved from the doc), `sync.uploadDirectory`, `sync.downloadDirectory`, `sync.spotdlCommand`,
      `sync.beetsConfig`.
- [x] **`sync` command and cache:** (p1) refreshes the cache of Liked Songs and mapped playlists (playlists
      skipped when their snapshot is unchanged) and reports per target: songs to add, songs without a
      Spotify id, tracks to prune, and tracks to pull.
- [x] **Beets integration:** `musicman sort` (`--dry-run` to preview) finds rated songs in beets' unsorted
      folder (from its default path) with a grouping that has a beets path rule, runs `beet update -m` for
      songs beets has and `beet import -s -q -A` for the others, then updates the database.
- [x] **Spotify track ids:** (p1) `sync --match` (`--dry-run` to preview): beets ids, then ISRC, then scored
      artist/title search; confident matches written as `TXXX.sp_track_id`, probable ones listed by
      `sync --review`, misses rechecked after 30 days.
- [x] **Spotify fields:** (p2) [feature] `sync --match` writes the `spotify.fields` mapping (track, album, and
      artist fields) as `TXXX.sp_*` tags, fills empty standard tags from fallbacks, refreshes them after
      `spotify.refreshDays` (or with `--refresh`), and reports response paths that are not mapped or ignored.
- [ ] **Spotify audio features:** (p3) [feature] populate acousticness, danceability, energy, instrumentalness,
      key, liveness, loudness, mode, speechiness, tempo, time_signature, valence. Blocked: `/audio-features`
      and `/audio-analysis` return 403 for this app (checked 2026-10-20); needs another source.
- [x] **Liked Songs:** (p1) `sync --push` saves every song rated at least `sync.likedRating` that has a
      Spotify id; `--prune` removes liked tracks whose song is now rated lower.
- [x] **Grouping playlists:** (p1) `sync --push` adds songs matching each `sync.playlists` filter to its
      playlist; `--prune` removes tracks whose song no longer matches. Playlist add/remove use the
      `/items` endpoints with a `/tracks` fallback, not yet verified against a real playlist.
- [x] **Pull Spotify-side changes to songs already in the library:** (p1) [feature] every sync that is not a dry
      run stores what each target and the tags agree on (`spotify_synced`); the plan compares Spotify, that state,
      and the tags three ways. `sync --pull` adds or removes multi value filter tags (context, picks) for changes
      made on Spotify and lists Liked Songs and grouping changes to decide; `--prune` only removes local changes.
- [ ] **Verify `sync --push` against Spotify** (p2) [test] the first push to Liked Songs and a playlist (the
      `/items` endpoints and their `/tracks` fallback).
- [ ] **`sync --push` export:** (p2) [feature] export songs missing from Spotify to `sync.uploadDirectory`, one subfolder per
      target playlist (hardlinks when possible), with a `README.md` checklist and printed summary. Verify first
      how Spotify desktop Local Files sources handle subfolders.
- [ ] **Verify pushed local files:** (p2) [feature] on `sync`, read local tracks in the mapped playlists, report songs still
      missing, and remove completed ones from the export directory.
- [x] **`sync --pull` manifest:** writes `manifest.json` to `sync.downloadDirectory` with each Spotify-only
      track's URL, its targets, and the tags those targets' filters imply (`--dry-run` to preview).
- [x] **spotDL download script:** (p2) [feature] `pnpm download` (in `cli/`) downloads the manifest with spotDL using
      `{track-id}` in the output template; reruns skip downloaded and imported tracks.
- [x] **`sync --import`:** (p2) [feature] matches downloads to the manifest by track id, writes the Spotify fields,
      empty standard tags, and playlist tags, runs `beet import -s -q --quiet-fallback=asis -l <log>` into
      `Sorted/Unrated/_Singles`, reports files imported as is or skipped, marks them imported in the manifest, and
      updates the database.
- [ ] **Verify `sync --pull`, `pnpm download`, and `sync --import` end to end** (p2) [test] on a real manifest once
      the Spotify rate limit lifts; only the beets step was checked against real beets (2026-10-21).
- [ ] **`import` command wrapping beets:** (p2) [feature] one command for newly downloaded files, reading the beets
      config (paths, import settings) so it tags and renames like beets would:
      - tell full albums from singles (album import vs `-s` singletons) and import each the right way
      - for spotDL downloads, add the tags of every playlist the track is in (a song in several playlists gets all
        their tags, multi value fields collect every value) plus all the `spotify.fields`
      - files that did not come from Spotify go through the `sync --match` lookup (beets id, ISRC, search) first
      - supersedes `sync --import`, which only handles manifest downloads as singletons
- [x] **`sync --backup`:** (p1) [feature] mirror the library files to a backup location (`/mnt/nfs/Music` now).
      Before changing anything, list the files to copy, update, and delete and confirm; deletions are opt-in and
      listed separately. Refuse to overwrite a backup file whose tag has frames the library copy lacks (how the
      frames lost on 2026-10-21 were recovered) and report those instead.
- [ ] **Progress feedback for `sync --backup`:** (p2) [feature] the comparison (walking both trees over NFS and reading
      the tags of changed mp3s for the frame check) runs for minutes with no output, so it looks hung. Show a status
      line while comparing (files scanned on each side, changed files checked of total, elapsed time), and bytes
      copied with rate and ETA while copying, not only file counts.
- [ ] **`check` command:** (p2) [feature] report, and with `--fix` repair (recorded for `musicman undo <run>`): files
      that cannot be read or rewritten, frames node-id3 cannot keep, database drift, duplicate songs, custom tag
      names that differ only by case or punctuation (renamed to a `check.names` list seeded with beets names),
      custom tags duplicating standard frames, the leftover `spotify_track_id` frames, and multi value formatting.
      Also report ratings off the half step scale (e.g. Hollerado - Got to Loose is 2.8) and text that looks
      garbled by a wrong encoding (its copyright reads `20･･－－－0`). `lib/check/frames.js` (raw frame parsing)
      is done.
- [x] **Stricter Spotify version matching:** (p2) [bug] matches (search and ISRC) need the same title words and the
      same words in removed suffixes (Campfire mix vs Dub Mix, Early Version, Radio Edit, Happy Home II), otherwise
      they go to review.
- [x] **Recheck existing matches and review with accept and reject:** (p1) [feature] `sync --match --recheck` moves
      matches failing the title rule to review without unlinking them (45 in scope on 2026-10-21); `sync --review
      --accept` / `--reject` pick with fzf. Rejected tracks are removed by the next push (no `--prune` needed), are never
      offered as downloads, and the song is looked up again without them (schema 4).
- [x] **Match similarity percent:** (p2) [feature] `matchSimilarity` in `lib/spotify/match.js` scores a match
      (100% identical) by duration (free up to 3s, above 95% up to 20s) and title (case and punctuation free, a
      neutral suffix like a remaster -1, 2 per changed character, -10 per mix or version word such as Radio or
      Rough, -25 per version marker such as live or remix). Shown as the first column of the `sync --review` list,
      accept sorted most similar first and reject least similar first. Written as `TXXX.sp_diff_percent` and
      `TXXX.sp_diff_details` on every match, accepted review, and refresh.
- [x] **Auto-accept close matches:** (p2) [feature] `sync.autoAcceptPercent` (e.g. 95) matches review candidates at
      least that similar without review; empty by default, so nothing changes until it is set.
- [x] **Live recordings score as studio matches:** (p1) [bug] a song whose MusicBrainz album type is `live` or
      whose album title names a live recording ("Live at ...", "(Live)", ": Live Recordings") now differs from a
      studio candidate like a version marker (-25), and a Spotify album such as "[Live at the Pantages Theatre]"
      counts as live. The 28 live songs at or above 95% on 2026-10-24 now score about 75%.
- [ ] **Prefer the original album over compilations:** (p2) [feature] a match can be the right recording on the wrong
      release, e.g. Alice in Chains - Heaven Beside You matched to "Alternative Moments" (Various Artists) instead of
      their own album. When several candidates are the same recording, rank by the local album (TALB) first, then
      album_type album over single over compilation, and skip various artists releases. Add a `sync --match
      --recheck` pass (or a review reason) for existing matches on compilations whose song has its own album.
- [x] **Icon for linked in the review list:** (p3) [feature] a nerd font link icon replaces `linked` and a unicode
      arrow replaces `->`.
- [x] **Listen to both versions in review:** (p3) [feature] in the review fzf list, ctrl-l plays the song with mpv
      (pausing Spotify), ctrl-s plays the candidate in the Spotify desktop app through `playerctl open` (or its
      `spotify:` URI handler when the app is not running), ctrl-x stops; closing the list stops mpv. Not tried in a
      real review session yet; MPD is not paused.
- [x] **Spotify artist metadata on tracks:** (p2) [feature] popularity (`sp_artist_popularity`), followers
      (`sp_artist_followers`), and genres (`sp_genres`, kept under its existing name) were already mapped; added the
      photo URL (`sp_artist_image`), and `sync --match` saves each first artist's photo to
      `spotify.artistImageDirectory` (default `$XDG_CACHE_HOME/musicman/artists/<sp_artist_id>.jpg`) for offline use.
      Only the first artist is fetched.
- [ ] **Spotify artist metadata for every credited artist:** (p3) [feature] `fetchDetails` only fetches
      `artists[0]`, so genres, popularity, and photos of featured or second artists are never stored. Decide whether
      the extra artist requests are worth it and how multi value fields would hold them.
- [x] **Spotify album metadata on tracks:** (p2) [feature] `sp_album_popularity` was already mapped; added the
      largest album image URL as `sp_album_image`. Embedding the image itself (APIC, for offline players) is part of
      "Fetch missing artwork for singles".
- [ ] **Guess the grouping of downloads:** (p2) [feature] for each track handed to spotDL, guess its grouping (genre) from
      the library: groupings of the same artist's songs first, then songs whose Spotify artist genres overlap. Record the
      guess (and why) in the manifest and download into a folder named after it, but never write it to the grouping
      tag, whose presence marks a song as organized and rated.
- [ ] **Assign the guessed grouping once a song is rated:** (p2) [feature] check whether beets can route imports into
      `Unrated` by the absence of a rating instead of the absence of a grouping (a path query on a rating field, e.g.
      through the types or mpdstats plugin). If it can, write the guessed grouping on import and let the rating decide
      the folder; otherwise keep the guess out of the tag.
- [ ] **`download` command:** (p2) [feature] search Spotify for artists and albums, pick results (fzf), add them to the
      manifest, fetch them with spotDL (see "Revisit running spotDL from musicman"), and import them (the beets wrapping
      `import` command), with the grouping guess above.
- [ ] **`download --missing`:** (p2) [feature] scan the library for albums of wanted artists that are not in it and suggest
      them. An artist with their own folder (`.../Artists/<artist>/`) means their full catalogue is wanted. Cache the
      Spotify discographies so the check is quick, and say at the start of the command how much is missing, e.g.
      "notice: 28 albums across 15 artists are not imported yet".

## Playback and integrations

- [ ] **Now playing screen:** (p2) [feature] improve what `musicman` / `view` without arguments shows for the playing
      song: Nerd Font icons for fields, a progress bar for the position in the track, and when Spotify is playing, its
      track details and the names of the mapped playlists the song is in.
- [ ] **Playback controls for MPD and Spotify:** (p2) [feature] one set of mpc style commands (play, pause, next, previous,
      seek, volume, queue) that acts on whichever player is active, plus musicman features such as playing a search
      result or a filter. Spotify control goes through the Web API player endpoints (needs the
      `user-modify-playback-state` and `user-read-playback-state` scopes and a new login).
- [ ] **`status` command:** (p2) [feature] show the active player (MPD or Spotify), the playing song with its rating and
      tags, and the playlist or queue it is playing from.
- [ ] **Like or ignore the Spotify song that is playing:** (p2) [feature] save it to Liked Songs, or add it to an "always
      ignore" playlist set in a new config option (e.g. `sync.ignorePlaylist`), which sync then leaves alone: never
      pulled, matched, or downloaded.
- [ ] **rofi menu for the playing song:** (p2) [feature] a rofi interface that, when Spotify is playing, adds the song to
      any mapped playlist, Liked Songs, or the ignore playlist, and when MPD is playing, sets the rating, grouping,
      context, mood, and picks (writing tags like `edit`).
- [ ] **Own song change notifications:** (p2) [feature] replace the mpDris2 notifications (unreliable now) by extending
      `lib/notify-daemon.js`: show the source (Spotify or MPD), the rating when there is one, context and mood labels,
      and the album cover. Follows the testability refactor above.
- [ ] **Lyrics:** (p3) [feature] fetch lyrics for the playing song (embedded USLT first, then an online source) and show
      them like Spotify's mini player, scrolling along with the playback position when the lyrics are synced (LRC).
- [ ] **Smart playlists on Spotify:** (p3) [feature] generate playlists from the library's own metadata (context, mood,
      picks, rating, grouping, Spotify genres and popularity) instead of only fixed filters, and push them like the
      mapped playlists. First look into services or libraries that build better smart playlists from that kind of
      metadata.
- [ ] **Mood analysis services:** (p3) [feature] evaluate APIs that tag songs with moods (to fill or suggest the
      `mood` tag and replace the blocked Spotify audio features): bridge.audio, SonoTeller, Cyanite.ai, Musiio, AIMS
      API. Compare coverage, price, whether they analyze uploaded audio or only catalogue ids, and rate limits.
- [ ] **Lyrics analysis and sources:** (p3) [feature] evaluate Musixmatch Pro, lyricsgenius (Genius), and
      LRCLIB/lrcget (synced LRC lyrics, free and offline friendly) as sources for the Lyrics item and for lyric based
      tags (themes, explicitness, language).
- [ ] **Genre analysis services:** (p3) [feature] evaluate Every Noise at Once, Chosic music genre finder, PitchPlus,
      and SubmitHub "What's my genre" for finer genres than Spotify's artist genres, to help guess groupings
      ("Guess the grouping of downloads"). Several are websites without an API, so check what can be automated.
- [ ] **Other music services:** (p3) [feature] support services besides Spotify (e.g. YouTube Music, SoundCloud) for
      matching, playlist sync, and playback, starting with which ones have a usable API.

## Undo and history

Runs record their tag and Spotify changes for `musicman undo` (since 1.24.0). Still missing: `sync --backup` moves
files deleted from the library to `.musicman-removed/<date>/` but overwrites changed ones, and the database
backups (`db.autoBackup`) have no restore command.

- [x] **Tag change journal and `undo`:** (p1) [feature] every archived run records the frames each tag write
      replaces (`tag_changes`, schema 5: the value before and a hash of the value after) through
      `lib/history/journal.js`, hooked into `lib/metadata/write.js`. `musicman undo [<run> | --list] [--dry-run]
      [--force]` restores them, holding back files changed since; the last `history.keep` (50) runs are kept.
- [x] **Spotify change journal and undo:** (p1) [feature] `sync --push` records each add and remove
      (`spotify_changes`) and the snapshot saved before it; `musicman undo <run>` reverses them (one command for tags
      and Spotify rather than `sync --undo`), putting removed tracks back at their old playlist position and
      updating `spotify_synced` so the next sync sees a local change.
- [ ] **Follow moved files in the undo history:** (p2) [feature] the history keys files by path, so a write
      followed by a move (`sort`, the beets step of `sync --import`) makes undo report the file as missing. When
      `db --update` detects a move (same MusicBrainz track id), update `tag_changes.path` too.
- [ ] **Record `check --fix` changes:** (p3) [feature] once `check --fix` exists it writes through
      `lib/metadata/write.js` and is recorded automatically; make sure its run archives (the `archive` flag) so
      `undo` covers it, replacing the planned `check --undo`.
- [ ] **Keep replaced files in `sync --backup`:** (p2) [feature] move the backup copy of an updated file to
      `.musicman-removed/<date>/` (or a versions folder) before overwriting it, like deleted files, so a bad tag
      write that reached the backup can still be recovered.
- [ ] **Restore the database from a backup:** (p3) [feature] `db --restore [<backup>]` to list and restore the
      automatic database backups; there is no command for it now.

## Housekeeping

- [ ] (p3) [chore] Remove stale tracked files: `cli/test_output.txt`, `cli/test_output2.txt`, `cli/SESSION_SUMMARY.md`,
      `cli/CONTEXT.md` (superseded by root `CONTEXT.md`).
- [ ] (p3) [chore] Remove or update the untracked repo copy of `.musicmanrc.yml` (old config format).
- [ ] (p3) [docs] Update the stale "Current Session Context" section in `cli/CLAUDE.md`.
