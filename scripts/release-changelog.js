#!/usr/bin/env node
// commit-and-tag-version postbump script: moves the committed [Unreleased] entries of CHANGELOG.md (HEAD's)
// into a section for the new version and stages that file, so the release commit carries the hand-written
// notes and nothing another session is still writing. Entries not committed yet stay under [Unreleased] in
// the working copy. The prerelease check (--check) refuses a release while anything is staged, since
// commitAll commits the whole index.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoUrl = 'https://github.com/njhoffman/musicman';

/**
 * CHANGELOG text with the [Unreleased] entries released as version on date (YYYY-MM-DD), and the link
 * references updated. Throws when [Unreleased] is missing or empty, or the version is already released.
 */
const releaseChangelog = (text, version, date) => {
  const lines = text.split('\n');
  const start = lines.findIndex(line => /^## \[Unreleased\]/.test(line));
  if (start === -1) {
    throw new Error('CHANGELOG.md has no ## [Unreleased] section');
  }
  if (lines.some(line => line.startsWith(`## [${version}]`))) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const next = lines.findIndex((line, i) => i > start && /^## \[/.test(line));
  const end = next === -1 ? lines.length : next;
  const entries = lines.slice(start + 1, end);
  if (!entries.some(line => /^- /.test(line))) {
    throw new Error('CHANGELOG.md has no entries under ## [Unreleased], add them before releasing');
  }

  const released = [
    ...lines.slice(0, start + 1),
    '',
    `## [${version}] - ${date}`,
    '',
    ...entries.slice(entries.findIndex(line => line.trim())),
    ...lines.slice(end)
  ];

  // [Unreleased] compares from the new version, which compares from the previous one
  const refIndex = released.findIndex(line => line.startsWith('[Unreleased]: '));
  if (refIndex === -1) {
    return released.join('\n');
  }
  const previous = (released[refIndex].match(/compare\/(v[^.]+\.[^.]+\.[^.]+)\.\.\.HEAD/) || [])[1];
  released.splice(
    refIndex,
    1,
    `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`,
    previous
      ? `[${version}]: ${repoUrl}/compare/${previous}...v${version}`
      : `[${version}]: ${repoUrl}/releases/tag/v${version}`
  );
  return released.join('\n');
};

// the [Unreleased] entries of a changelog: [{ heading, text }], heading the ### line above it (or null),
// text an entry's lines (its "- " line and the lines continuing it)
const unreleasedEntries = text => {
  const lines = text.split('\n');
  const start = lines.findIndex(line => /^## \[Unreleased\]/.test(line));
  if (start === -1) {
    return [];
  }
  const entries = [];
  let heading = null;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^## \[/.test(line) || /^\[[^\]]+\]: /.test(line)) {
      break;
    }
    if (/^### /.test(line)) {
      heading = line;
      current = null;
    } else if (/^- /.test(line)) {
      current = { heading, lines: [line] };
      entries.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.lines.push(line);
    } else {
      current = null;
    }
  }
  return entries.map(entry => ({ heading: entry.heading, text: entry.lines.join('\n') }));
};

/**
 * The released changelog with the entries of the working copy that the committed changelog does not hold
 * put back under [Unreleased], under their ### headings.
 */
const keepPending = (released, working, committed) => {
  const done = new Set(unreleasedEntries(committed).map(entry => entry.text));
  const pending = unreleasedEntries(working).filter(entry => !done.has(entry.text));
  if (pending.length === 0) {
    return released;
  }
  const headings = [...new Set(pending.map(entry => entry.heading))];
  const block = headings.flatMap(heading => [
    ...(heading ? [heading, ''] : []),
    ...pending.filter(entry => entry.heading === heading).map(entry => entry.text),
    ''
  ]);
  const lines = released.split('\n');
  const start = lines.findIndex(line => /^## \[Unreleased\]/.test(line));
  return [...lines.slice(0, start + 1), '', ...block, ...lines.slice(start + 2)].join('\n');
};

const git = (root, args, input) =>
  execFileSync('git', args, { cwd: root, input, encoding: 'utf8' }).trim();

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const file = path.join(root, 'CHANGELOG.md');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const date = new Date().toLocaleDateString('en-CA');
  // --check (the prerelease script) only validates, so a release without notes stops before the bump
  const check = process.argv.includes('--check');
  try {
    const staged = git(root, ['diff', '--cached', '--name-only']);
    if (check && staged) {
      throw new Error(
        `staged files would go into the release commit, commit or unstage them first:\n${staged}`
      );
    }
    const committed = git(root, ['show', 'HEAD:CHANGELOG.md']);
    const released = releaseChangelog(`${committed}\n`, check ? 'unreleased' : version, date);
    if (!check) {
      const blob = git(root, ['hash-object', '-w', '--stdin'], released);
      git(root, ['update-index', '--cacheinfo', `100644,${blob},CHANGELOG.md`]);
      fs.writeFileSync(file, keepPending(released, fs.readFileSync(file, 'utf8'), committed));
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { keepPending, releaseChangelog, unreleasedEntries };
