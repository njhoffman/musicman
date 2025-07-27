# Context & Preferences for Claude Code Sessions

This document preserves important context and working preferences for future Claude Code sessions.

## User Working Style & Preferences

### Communication Style
- **Be concise** - Keep responses to 4 lines or less unless detail is requested
- **Minimize output tokens** while maintaining helpfulness and quality
- **No unnecessary preamble/postamble** - avoid "Here's what I will do" or explanations unless asked
- **Direct answers** - one word answers are preferred when appropriate
- **Follow conventions** in the existing codebase rather than introducing new patterns

### Code Guidelines
- **NEVER add comments** unless explicitly requested
- **Follow existing patterns** - mimic code style, use existing libraries, follow established naming
- **Always check dependencies** - never assume libraries are available, check package.json first
- **Security first** - never introduce code that exposes secrets, follows security best practices
- **Edit over create** - always prefer editing existing files to creating new ones
- **NO documentation files** - never proactively create .md or README files unless requested

### Testing Philosophy
- **Be thorough but succinct** - test intentional functionality, not trivial things
- **Follow existing patterns** - use the same structure and style as existing tests
- **Use async/fixtures/mocks** as necessary
- **Look for commented out tests** as starting points for new tests
- **Focus on real functionality** over implementation details

### Development Workflow
- **Always run tests** after making changes
- **Run linter and fix issues** before committing
- **Use TodoWrite tool** extensively to track progress and give user visibility
- **Mark todos complete immediately** after finishing tasks (don't batch)
- **Commit with descriptive messages** using conventional commits + gitmoji
- **Version appropriately**: patch for fixes, minor for features, major for breaking changes

## Project-Specific Context

### Current Project: MusicMan CLI
- **Purpose**: MP3 metadata management CLI that integrates with MPD (Music Player Daemon)
- **Language**: Node.js using CommonJS modules (.cjs files)
- **Testing**: Mocha + Chai + Sinon with proxyquire for mocking
- **Main components**: parser, commands, metadata handling, MPD client, output formatters

### Recent Major Work Completed
1. **Dependency updates** - Updated all CLI and root package dependencies systematically
2. **ID3 tag names** - Updated tags.json with 13 specific mappings + 58 new descriptive names
3. **Comprehensive test suite** - Added unit and integration tests for all major components:
   - metadata/read.spec.cjs - metadata reading functions with mocking
   - metadata/write.spec.cjs - metadata writing and merging operations
   - clients/mpd.spec.cjs - MPD client connection and song retrieval
   - utils/files.spec.cjs - file operations and utilities
   - commands/edit.spec.cjs - edit command workflow with confirmation logic
   - integration.spec.cjs - parser-to-command workflows and component integration
4. **Test infrastructure** - Used proxyquire for proper dependency mocking, handled NODE_ENV testing issues
5. **All tests passing** - Resolved from 8 failing tests to 91 passing tests

### Test Patterns Established
- Use proxyquire for mocking dependencies instead of direct sinon stubbing
- Handle environment-dependent code by clearing require.cache and setting NODE_ENV
- Mock prompt-confirm constructor for testing user interaction flows
- Test actual functionality paths, not just happy paths

### Known Technical Details
- **Environment issue**: nvm incompatibility with npm_config_prefix (user is fixing)
- **Test environment**: NODE_ENV=test disables confirmation prompts in edit command
- **Linting**: ESLint configured but some unavoidable warnings for test dependencies
- **File structure**: lib/ for source, test/ mirrors lib/ structure, .spec.cjs for unit tests

## Common Commands to Remember
```bash
npm test                    # Run all tests
npm run lint               # Check code style
npx eslint lib/**/*.cjs    # Direct ESLint on source files
git add . && git commit -m "message"  # Standard commit flow
```

## Future Session Onboarding
When starting a new session:
1. Read this CONTEXT.md and CLAUDE.md first
2. Check git log for recent changes
3. Run `npm test` to verify current state
4. Ask user what they want to work on
5. Use TodoWrite tool to track any multi-step tasks

## Notes for Transfer to New Projects
- The testing patterns (proxyquire, environment handling) are reusable
- The TodoWrite tool usage for visibility is valuable
- The concise communication style preference should carry over
- The "edit over create" and "follow existing patterns" principles are universal