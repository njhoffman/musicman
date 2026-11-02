## Library checks

`musicman check [target]` reports problems in the library and changes nothing. Without a target it checks
the whole library (`mpd.baseDirectory`); a directory inside it narrows the check to the songs there.

```sh
musicman check                         # every check, every finding
musicman check --only=names,duplicates # some checks (-c)
musicman check --format=json           # every finding, for scripts
```

Each check prints `ok`, or a count and its first 10 findings; the last line says how many checks found
something. The command exits 1 when any did, so it can run from cron or a hook.

| Check        | Reads    | Reports                                                                                        |
| ------------ | -------- | ---------------------------------------------------------------------------------------------- |
| `drift`      | files    | files changed since the last `db --update`, songs whose file is gone, files not in the db      |
| `unreadable` | files    | files without an ID3v2 tag, not writable, or with a tag that cannot be read or walked          |
| `frames`     | files    | frames node-id3 does not understand in a tag musicman cannot copy them back into               |
| `names`      | database | custom field names that differ only by case or punctuation, the most used one suggested        |
| `standard`   | database | custom fields that duplicate a standard frame (`TXXX.Comment` for `COMM`)                      |
| `spotify-id` | database | leftover `TXXX.spotify_track_id` frames (the id now lives in `sp_track_id`)                    |
| `multi`      | files    | multi value fields with empty items (`Lounge,Study,`), spaces around items, or repeats         |
| `case`       | database | values of a multi value field that differ only in case across the library                      |
| `rating`     | database | ratings off the half step scale (2.8), and rating frames that cannot be read                   |
| `encoding`   | database | text that looks garbled by a wrong encoding                                                    |
| `duplicates` | database | the same song in more than one file (below)                                                    |
| `rare`       | database | context, mood, and picks values at most `check.rareCount` (3) songs use, with a close spelling |
| `artwork`    | database | songs without an embedded cover, with the Spotify album image when matched                     |
| `exclusive`  | database | songs and Spotify tracks in more than one rating or grouping playlist (below)                  |

Database checks query `song_tags`, which holds every populated frame of every file, so they are as current
as the last `db --update`; `drift` shows how far behind that is. File checks read each file's tag (not its
audio) once; the whole library takes about 40 seconds.

- `frames`: when musicman writes tags it copies the frames node-id3 drops (TCMP, TSOC, ...) back into the
  new tag, but only into a plain ID3v2.3 tag; in an ID3v2.4 tag, or one with an extended header, they would
  be lost. Other files are fine and not listed.
- `encoding` looks for the replacement character, UTF-8 read as Latin-1 (`Ã©`, `â€™`), control
  characters, and halfwidth or fullwidth forms in text without Japanese, Chinese, or Korean characters.
- `duplicates` groups files with one Spotify track id, one MusicBrainz release track id, or the same artist
  and title (ignoring case, punctuation, and accents) with lengths within 2 seconds. A group found by an id
  is not listed again by name. The same recording on an album and a compilation is reported too; it may be
  intended.

- `rare` counts each value of `stats.multiFields` (context, mood, picks) over the whole library and lists the
  checked songs using it. A rare value may be new; one a single edit from a common value (two from eight
  letters) comes with it as a suggestion, e.g. `mood:Ubpeat (1 song), maybe Upbeat (40)`.
- `exclusive` treats the `sync.playlists` whose filter is one `field:value` term on a single value field
  (rating, grouping; not context or mood) as a group a song belongs in at most one of; the `.Artists` and
  `.Singles` filters of one grouping playlist are one member. It reports songs whose tags match two playlists
  of a group, and tracks in two playlists of a group on Spotify (as of the last `sync`), saying which
  playlist the tags call for. Usually the track is linked to two copies of a song that disagree (an album
  and a live file rated 5.0 and 4.5); push puts a track wherever any copy belongs, so it is in both.

## Repairs

```sh
musicman check --fix --dry-run                # what would change, writes nothing
musicman check --pick                         # duplicate groups no rule decides, one at a time
musicman check some/dir --fix --only=multi    # one check under one directory
musicman check --fix                          # every repair, after one confirmation
```

`--fix` runs the checks, prints the report, then plans the repairs of the ones below by reading each
affected file's tag, prints every change, and asks once before
writing. Each file's tag is rewritten once with every repair it needs, keeping frames node-id3 does not
understand, and the database is updated after. The run is archived like other changes, so
`musicman undo <run id>` restores the tags. Without a terminal to ask in nothing changes.

| Check        | Repair                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `names`      | renames each spelling to one: a configured tag id or a `check.names` entry, else the most used    |
| `standard`   | removes the custom field when the standard frame has the same text; fills an empty standard frame |
| `spotify-id` | removes `TXXX.spotify_track_id` from files that have `sp_track_id`                                |
| `multi`      | writes the field without empty or padded items, each item once                                    |
| `case`       | writes each value in its most used casing                                                         |
| `artwork`    | embeds the Spotify album cover (`sp_album_image`, downloaded once per album) as the front cover   |
| `drift`      | updates the database for the target (`db --update`)                                               |

What a repair cannot decide is listed as left for you and not changed: two spellings of a name with
different values, a custom field whose text differs from its standard frame, a custom grouping when TIT1
is empty (grouping decides the Spotify playlists, so it is never set on its own), and a date that is not a
year for TYER, and a song without a cover that was not matched on Spotify (beets fetchart only finds album
covers, not singleton ones). Run `sync --match --recheck` before the artwork repair, so songs matched to a
compilation get their original album's cover. `rating`, `encoding`, `rare`, and `exclusive` need a
decision per song and stay reports; `--fix` names them when they found something.

### Duplicates

After the tag repairs, `--fix` plans each duplicate group (groups that share a file are joined). One copy
is kept, by rules in order:

1. Another recording is a wrong Spotify match, not a duplicate: a copy on a `live` or `remix` release, or
   with a version in its title (`(radio edit)`, `(acoustic)`, `(Arsenal mix)`, `(new vocal version)`),
   stays in the library and is matched again: its studio Spotify id and fields are removed and that
   track is rejected for it, so `sync --match` finds its own track and push adds it to the playlists.
2. A Rated copy is kept over `Unrated/` imports.
3. Of numbered copies (`Song.1.mp3` next to `Song.mp3`) with the same audio (compared without the ID3
   tags), the file without the number is kept. Numbered copies with other audio are picked.
4. An album copy is kept over an EP, an EP over a single (a `single` release or a `Singles` folder), a
   single over a compilation or soundtrack.

What happens to a copy that is not kept:

| Copy | Database and Spotify | File |
| ---- | -------------------- | ---- |
| a single in a `Singles` or `_Singles` folder, when an album copy under `Artists` is kept | out | to the trash |
| a numbered copy with the same audio | out | to the trash |
| any other (compilation, EP, `single` release, the copies not picked) | out | stays where it is |

Copies out of the library are listed in the `excluded_songs` table: `db --update`, the commands reading
the library, and the drift check skip them, and `sync --push` removes their Spotify tracks from the
playlists (like tracks rejected in review) instead of `sync --pull` fetching them again. The kept copy
gets their context, picks, and mood values (multi value fields), and the rating of the newest copy that
has one (by file time) when it differs.

Tied copies with the same audio are decided too: the copy whose file name is closest to its own ID3
title is kept, then (when those tie) closest to its Spotify artist and title; the others go to the
trash from a Singles folder and leave the library elsewhere.

`--fix` applies every group the rules decide after one confirmation. The groups left (one single in two
grouping folders, numbered copies with other audio, two album tracks matched to one track) are listed
for `musicman check --pick`, which goes through them one at a time in fzf: each copy with its length,
size, audio CRC, rating, and title, and a header saying whether the audio and lengths are the same. The
copy picked is kept and the others leave the library (files kept), applied right away; `skip` (or esc)
leaves a group for later and `stop` ends the picking.

Trashed files are taken out of beets (`beet remove`) and moved to `<db.backupDirectory>/trash/<run
id>/<path>`. `musicman undo <run id>` takes it all back: trashed files move back and are imported into
beets again where they are (only the `types` plugin loaded, so lyrics, replaygain, and scrub leave the
file alone), excluded songs are let back in, and the kept copy's tags and the cleared matches are
restored. The trash is never emptied by musicman. The `Duplicates` tab of `musicman ui` shows the same
plan with every copy to play and its size, audio CRC, and rating. `Only groups to pick` lists the groups
left; picking a copy and repairing its group moves on to the next one. `Repair N groups` repairs every
decided group. Its runs are undone from the `History` tab.

The first repair of a whole library rewrites a few thousand tags; back the files up first
(`musicman sync --backup`), and try one directory before the rest.
