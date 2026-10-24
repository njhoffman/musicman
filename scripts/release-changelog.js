#!/usr/bin/env node
// commit-and-tag-version postbump script: moves the [Unreleased] entries of CHANGELOG.md into a section for
// the new version and stages the file, so the release commit carries the hand-written notes.
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

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const file = path.join(root, 'CHANGELOG.md');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const date = new Date().toLocaleDateString('en-CA');
  // --check (the prerelease script) only validates, so a release without notes stops before the bump
  const check = process.argv.includes('--check');
  try {
    const released = releaseChangelog(
      fs.readFileSync(file, 'utf8'),
      check ? 'unreleased' : version,
      date
    );
    if (!check) {
      fs.writeFileSync(file, released);
      execFileSync('git', ['add', file], { cwd: root });
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { releaseChangelog };
