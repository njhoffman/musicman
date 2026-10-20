# MusicMan Project Context

## User Preferences & Working Style
- Prefers concise, direct responses without unnecessary explanations
- Values systematic approach with proper planning and tracking
- Expects comprehensive testing and validation
- Uses conventional commits with gitmoji
- Works in CommonJS format (.js files)
- Testing: Mocha + Chai + Sinon with proxyquire for mocking

## Project Structure
- **CLI**: `/home/nicholas/ghq/github.com/njhoffman/musicman/cli` - Main command-line interface
- **Common**: `/home/nicholas/ghq/github.com/njhoffman/musicman/common` - Shared configuration and utilities
- **Config**: User config at `/home/nicholas/.musicmanrc.yml` (symlinked)
- **Tests**: Located in `cli/test/` with integration and unit test structure

## Key Technologies
- Node.js with CommonJS modules
- ID3 metadata handling with node-id3  
- MPD (Music Player Daemon) integration
- Configuration management with cosmiconfig + YAML
- Custom config validation system

# Session Progress

## Session Summary (2026-10-20)
- **COMPLETED**: Views keyed by output format instead of command
- `views.table` and `views.list` replace `views.default/edit/playlist/stats`; the `vertical` format is renamed `list`
- Each view holds its display settings (moved from `output.table`/`output.vertical`) and a `tags` list
- `views.<format>.tags` order sets display order; `tags[].tableOrder` removed
- View tags must be in `library.tags` (`rating` always allowed), otherwise fatal error
- Outdated `output.table`, `output.vertical`, and `tags[].tableOrder` in user config are fatal errors
- Config merge replaces arrays from user config instead of merging by index
- `~/.musicmanrc.yml` migrated; `albumArtist` renamed to `album_artist` to match tags.json
- `library.tags` controls which tags are read, written, filtered, and assigned; `tags` only holds definitions
- `library.tags` must use text (`T***`) or custom (`TXXX.*`) frames and unique frames, otherwise fatal error
- `popularity` (POPM, used by rating) and `volume` (RVAD) removed from `library.tags`


## Current Session Summary (2025-01-27)
- **COMPLETED**: Major config restructuring per scratch.md instructions
- **Library Tags**: Added library.tags property with user custom tag support (context, mood)
- **Views System**: Implemented views.default/edit/playlist/stats configuration
- **Config Loading**: Fixed tag resolution to prioritize user custom tags over global tags.json
- **Logger Colors**: Converted from RGB arrays to hex codes with GUI styling support
- **Validation**: Enhanced config schema for all new properties
- **Tests**: Added comprehensive config test suite (9 tests passing)

## Key Technical Changes
1. **Config Structure**: 
   - `library.tags` now controls which tags are viewable/manipulable
   - `views` system replaces hardcoded viewIndex ordering (now `views.table`/`views.list`, see 2026-10-20)
   - Custom MP3 fields properly validated against user config

2. **Tag Resolution Logic**: 
   - User config tags checked first, then global tags.json fallback
   - Fatal errors for undefined tags (as requested)
   - Support for custom TXXX fields (Context, Mood)

3. **Logger Format**: 
   - Colors now use hex codes: `fg: '#FFFFFF'` instead of `[255, 255, 255]`
   - Added GUI styling: `gui: 'italic'/'bold'/'normal'/'underline'`

## Files Modified This Session
- `/home/nicholas/.musicmanrc.yml` - Added library.tags and views config
- `common/config/defaultConfig.yml` - Added defaults, converted logger colors
- `common/config/validator.js` - Enhanced validation schema  
- `common/config/index.js` - Fixed tag resolution logic
- `cli/test/unit/config.js` - New comprehensive test suite
- `cli/test/integration.js` - Added unit test inclusion

## Next Priority Tasks
1. **Database Integration** - User mentioned "next we will work on the database"
2. Monitor custom field sync changes (as noted in scratch.md)
3. Implement fatal error handling for changed custom field definitions
4. Consider performance optimization for tag resolution

## Current Status
- All config tests passing (9/9)
- Config loading works with new format
- Ready for database work phase
- No breaking changes to existing functionality

## Important Notes
- Custom MP3 fields (context, mood) must always be defined in local config
- Fatal misconfiguration if custom field not found in user config
- Config validation now handles new hex color format properly
- Tag resolution prioritizes user-defined tags over global tags.json