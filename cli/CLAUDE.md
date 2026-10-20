# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start CLI**: `pnpm start` or `node lib/cli.js`
- **Development mode**: `pnpm dev` (uses nodemon for auto-restart)
- **Run tests**: `pnpm test` (uses Mocha)
- **Test with coverage**: `pnpm test:coverage` (uses nyc)
- **Test watch mode**: `pnpm test:watch`
- **Lint code**: `pnpm lint` (ESLint)
- **Fix lint issues**: `pnpm lint:fix`
- **Lint watch mode**: `pnpm lint:watch`
- **Check config**: `pnpm config:check` (validates configuration)

## Architecture Overview

This is a Node.js CLI application for MP3 metadata management that integrates with MPD (Music Player Daemon).

### Core Components

- **Entry Point**: `lib/cli.js` - Main application entry, handles command parsing and execution
- **Command Parser**: `lib/parser/` - Parses CLI arguments into command, target, and options
  - Commands are parsed from args and current MPD song context
  - Targets can be files/directories or current playing song
  - Options include switches, filters, and field assignments
- **Commands**: `lib/commands/` - Available CLI commands (view, edit, playlist, stats)
- **MPD Client**: `lib/clients/mpd.js` - Connects to MPD and gets current song info
- **Metadata Handling**: `lib/metadata/` - Read/write MP3 metadata using node-id3
- **Output Formatters**: `lib/output/` - Various output formats (table, list, stats, differences), table and list configured by `views.table` and `views.list`

### Key Dependencies

- Uses CommonJS modules (`.js` files)
- **musicman-common**: Local dependency for shared configuration
- **node-id3**: MP3 metadata reading/writing
- **node:sqlite**: Built-in SQLite (Node 24) for the planned library database, no native dependency
- **cli-table3**: Column layout for table, list, and differences output via `lib/output/render.js` (cells are truncated before colors are applied)
- **Notify daemon**: `lib/notify-daemon.js` runs as a systemd user service (`pnpm daemon:install`, then `systemctl --user enable --now musicman-notify`)

### Testing Setup

- **Framework**: Mocha with Chai assertions
- **Test data**: `test/data/` contains MP3 files and metadata for testing
- **Global setup**: `test/setup.js` configures sinon, chai, and test globals
- **Integration tests**: `test/integration/` for command testing

### File Structure Notes

- All source files use `.js` extension (CommonJS, no `"type": "module"`)
- Test files mirror the `lib/` structure
- Uses absolute imports and proper CommonJS module.exports

## Development Workflow

### Mandatory Steps After Any Updates

1. **Always run tests** after completing any set of updates to ensure no regressions
2. **Run linter** and fix any issues before committing
3. **Check configuration** with `npm run config:check` to ensure config is valid
4. **Add comprehensive tests** for new functionality:
   - Unit tests for individual functions/modules
   - Integration tests for command interactions
   - Be thorough but avoid testing trivial/obvious functionality
5. **Commit and version** based on update scope:
   - **Patch bump**: Bug fixes, minor improvements, dependency patches
   - **Minor bump**: New features, significant improvements, dependency minor updates
   - **Major bump**: Breaking changes (decided together with user)

### Testing Guidelines

- Follow existing test structure in `test/` directory
- Use Mocha + Chai + Sinon pattern established in codebase
- Integration tests should use fixtures from `test/data/`
- Unit tests should be co-located with source files (`.spec.js` suffix)
- Test real functionality, not implementation details
- Mock external dependencies (MPD, file system when appropriate)

## Testing Patterns (Current Implementation)

### Unit Test Structure
- **Use proxyquire** for dependency mocking instead of direct sinon stubbing
- **Environment-dependent testing**: Delete require.cache and set NODE_ENV when needed
- **Constructor mocking**: Use function constructors for testing user interaction components
- **Comprehensive coverage**: Tests exist for all major modules with 91 passing tests

### Established Test Files
- `lib/metadata/read.spec.js` - Metadata reading with proxyquire mocking
- `lib/metadata/write.spec.js` - Metadata writing and assignment merging
- `lib/clients/mpd.spec.js` - MPD client connection and song operations
- `lib/utils/files.spec.js` - File system operations and utilities
- `lib/commands/edit.spec.js` - Edit command workflow including confirmations
- `lib/integration.spec.js` - Parser-to-command integration workflows

## Current Session Context
Last worked on major configuration restructuring. Implemented library.tags system, views configuration, and converted logger colors to hex format. Added comprehensive config validation and test suite. All 9 config tests passing. Ready for database integration phase.

### Key Changes This Session
- **Config Structure**: Added library.tags and views properties
- **Tag Resolution**: User custom tags now take precedence over global tags.json
- **Logger Format**: Converted to hex colors with GUI styling support
- **Validation**: Enhanced schema for new config properties
- **Tests**: Added `test/unit/config.js` with comprehensive coverage