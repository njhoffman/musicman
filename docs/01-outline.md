# Project Outline

- This is an existing NodeJS project that manages mp3 files and its metadata.
- It contains a command line interface (CLI) that allows you to add, remove, and list mp3 files.
- It allows custom fields to be added to the mp3 file, and then those fields can be used to generate a playlist.
- Configuration is stored in a file called `common/config/defaultConfig.yml` with user overrides in `~/.musicmanrc.yml`.
  - The tags field in the config file contains a list of all the ID3 available with attributes.
  - Attributes effect how fields are displayed and manipulated, user fields start with 'TXXX'.

## Project Structure

├──  cli/
│   ├──  lib/
│   │   ├──  clients/              - Client wrappers, only has mpd for currently playing song
│   │   ├──  commands/             - Command callback handlers after parsing from `parser`
│   │   ├──  metadata/             - Metadata filtering, reading, writing
│   │   ├──  output/               - Handling output and table formatting
│   │   ├──  parser/               - Interface for cli commands and options/arguments
│   │   └──  utils/                - Utility functions and helpers
│   └──  test/                     - Contains integration tests for the CLI
├──  common/                       - Shared code between cli and future services
│   ├──  config/                   - Configuration handlers and defaults
│   ├──  docs/                     - Project specs and design docs
│   ├──  mpd/                      - MPD base client interface

Testing is done using [Mocha](https://mochajs.org/) and [Chai](https://www.chaijs.com/)

Unit tests occupy the same folder as the code, with a `.spec` suffix.

There are command integration tests in `cli/test/integration/commands` that uses fixtures from
`cli/test/data/`.

## CLI Commands

- The main command is `view`, which shows the currently playing song if no target path given.
  - If a target path is given, it will list all the mp3 files in that directory that match provided
    criteria. The `-r` flag can be used to recursively search subdirectories.
  - Tag filters are given as `tag:value`, i.e. `rating:4.5 context:"relax"`
  - Rating is treated as a special case, as it uses a range filter.
  - Fields that are defined as 'multi' can have multiple values separated by `,` when searching or editing.
- The edit command is triggered when the tag arguments are set with `tag=value`
  - If no target is given, it will edit the currently playing song.
  - Otherwise, it will edit all the mp3 files in the target directory (asks confirmation first).
  - i.e. `rating=3.0 mood="upbeat,energetic" ~/Music` will set all the mp3 files in `~/Music` to a
    rating of 3.0 and mood to the two separate values.
  - If no path is given, it will edit the currently playing song if available.
  - The multi fields allow the `+` and `-` operators to be used to add/remove single values.
- The playlist command is triggered when the `playlist` argument is set.
  - By default it will generate a playlist set by the configuration of `playlist.outputPath` and
      `playlist.outputDirectory`
- The stats command is triggered when the `stats` argument is set.
  - It will show a table of stats about the mp3 files in the given directory.

## CLI Argument Summary

| Argument               | Description                                 |
| --------               | -----------                                 |
| (empty)                | Show currently playing song                 |
| `4.5`                  | If song playing, assign rating of 4.5       |
| [path]                 | List mp3 files in [path]                    |
| rating=5               | Assign rating of 5.0 to current song        |
| rating:5 [path]        | List mp3 files in [path] with rating of 5.0 |
| genre="rock" [path]    | Assign files in [path] to genre "rock"      |
| playlist -r rating:3.5 [path] | Generate playlist recursively with rating >= 3.5 |

## Next Steps
- Create a sqlite database and `db` commands that allow you to sync file metadata with the database.
- Have the cli commands use the db for filtering when viewing, making a playlist, or listing stats.
- Integrate spotify API with `spotify` commands.
  - First to link local files with spotify using track, album, and artist ids.
  - Second, find liked spotify songs that don't have a local file. Add option to download these.
  - Third, push playlists to spotify and upload any necessary songs.
  - Fourth, add spotify extras like spotify suggestions and a 'Do Not Suggest' playlist.

## Architecture and technical requirements
- Code Style: Clean, modern ES6/ES7 with minimal comments and consistent naming
- Error Handling: Comprehensive logging to file with timestamps for all operations
- Testing: Mocha tests with Chai assertions (`npm run test`), add unit and integration tests when
  needed following existing structure.
- Dependencies: Minimize external dependencies, prefer built-in Node.js modules
- Version Control: Use git for version control, commit messages following conventional commit format
  with gitmoji.  Project root `package.json` and git tags track version number.
- Documentation: Add necessary documentation for project, including README.md, USAGE.md for cli
  interface, and CHANGELOG.md for version history (automatically generate and update this file
  only when minor or major version bumps occur).

Before starting with the larger plans in #2 we are going to complete some smaller chores such as
updating dependencies.
