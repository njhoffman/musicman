# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start CLI**: `npm start` or `node lib/cli.cjs`
- **Development mode**: `npm run dev` (uses nodemon for auto-restart)
- **Run tests**: `npm test` (uses Mocha)
- **Test with coverage**: `npm run test:coverage` (uses nyc)
- **Test watch mode**: `npm run test:watch`
- **Lint code**: `npm run lint` (ESLint)
- **Fix lint issues**: `npm run lint:fix`
- **Lint watch mode**: `npm run lint:watch`

## Architecture Overview

This is a Node.js CLI application for MP3 metadata management that integrates with MPD (Music Player Daemon).

### Core Components

- **Entry Point**: `lib/cli.cjs` - Main application entry, handles command parsing and execution
- **Command Parser**: `lib/parser/` - Parses CLI arguments into command, target, and options
  - Commands are parsed from args and current MPD song context
  - Targets can be files/directories or current playing song
  - Options include switches, filters, and field assignments
- **Commands**: `lib/commands/` - Available CLI commands (view, edit, playlist, stats)
- **MPD Client**: `lib/clients/mpd.cjs` - Connects to MPD and gets current song info
- **Metadata Handling**: `lib/metadata/` - Read/write MP3 metadata using node-id3
- **Output Formatters**: `lib/output/` - Various output formats (table, vertical, stats, differences)

### Key Dependencies

- Uses CommonJS modules (`.cjs` files)
- **musicman-common**: Local dependency for shared configuration
- **node-id3**: MP3 metadata reading/writing
- **sqlite3**: Database operations
- **columnify**: Table formatting (custom fork)
- **forever**: Daemon management

### Testing Setup

- **Framework**: Mocha with Chai assertions
- **Test data**: `test/data/` contains MP3 files and metadata for testing
- **Global setup**: `test/setup.cjs` configures sinon, chai, and test globals
- **Integration tests**: `test/integration/` for command testing

### File Structure Notes

- All source files use `.cjs` extension (CommonJS)
- Test files mirror the `lib/` structure
- Uses absolute imports and proper CommonJS module.exports