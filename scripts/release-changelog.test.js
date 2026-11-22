const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { keepPending, releaseChangelog, unreleasedEntries } = require('./release-changelog');

const repo = 'https://github.com/njhoffman/musicman';
const changelog = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- A new command',
  '',
  '## [1.2.0] - 2026-10-01',
  '',
  '### Fixed',
  '',
  '- A bug',
  '',
  `[Unreleased]: ${repo}/compare/v1.2.0...HEAD`,
  `[1.2.0]: ${repo}/compare/v1.1.0...v1.2.0`,
  ''
].join('\n');

describe('releaseChangelog', () => {
  it('should move the unreleased entries under the new version and leave [Unreleased] empty', () => {
    const lines = releaseChangelog(changelog, '1.3.0', '2026-10-24').split('\n');
    assert.deepEqual(lines.slice(2, 9), [
      '## [Unreleased]',
      '',
      '## [1.3.0] - 2026-10-24',
      '',
      '### Added',
      '',
      '- A new command'
    ]);
    assert.ok(lines.includes('## [1.2.0] - 2026-10-01'));
  });

  it('should compare [Unreleased] from the new version and the new version from the previous one', () => {
    const text = releaseChangelog(changelog, '1.3.0', '2026-10-24');
    assert.match(text, /^\[Unreleased\]: .*\/compare\/v1\.3\.0\.\.\.HEAD$/m);
    assert.match(text, /^\[1\.3\.0\]: .*\/compare\/v1\.2\.0\.\.\.v1\.3\.0$/m);
    assert.match(text, /^\[1\.2\.0\]: .*\/compare\/v1\.1\.0\.\.\.v1\.2\.0$/m);
  });

  it('should release when [Unreleased] is the only section', () => {
    const text = releaseChangelog(
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- First\n',
      '0.1.0',
      '2026-10-24'
    );
    assert.match(
      text,
      /## \[Unreleased\]\n\n## \[0\.1\.0\] - 2026-10-24\n\n### Added\n\n- First\n/
    );
  });

  it('should refuse to release without unreleased entries', () => {
    const empty = changelog.replace('### Added\n\n- A new command\n\n', '');
    assert.throws(() => releaseChangelog(empty, '1.3.0', '2026-10-24'), /no entries under/);
  });

  it('should refuse a changelog without [Unreleased]', () => {
    assert.throws(
      () => releaseChangelog('# Changelog\n', '1.3.0', '2026-10-24'),
      /no ## \[Unreleased\]/
    );
  });

  it('should refuse a version that is already released', () => {
    assert.throws(
      () => releaseChangelog(changelog, '1.2.0', '2026-10-24'),
      /already has a section/
    );
  });

  it('should read the unreleased entries with their headings and continuation lines', () => {
    const text = changelog.replace(
      '- A new command\n',
      '- A new command\n  that wraps\n- Another\n\n### Fixed\n\n- A fix\n'
    );
    assert.deepEqual(unreleasedEntries(text), [
      { heading: '### Added', text: '- A new command\n  that wraps' },
      { heading: '### Added', text: '- Another' },
      { heading: '### Fixed', text: '- A fix' }
    ]);
    assert.deepEqual(unreleasedEntries('# Changelog\n'), []);
  });

  it('should put the entries not committed yet back under [Unreleased]', () => {
    const working = changelog.replace(
      '- A new command\n',
      '- A new command\n- Uncommitted work\n  of another session\n\n### Fixed\n\n- Its fix\n'
    );
    const released = releaseChangelog(changelog, '1.3.0', '2026-10-24');
    const text = keepPending(released, working, changelog);
    assert.match(
      text,
      /## \[Unreleased\]\n\n### Added\n\n- Uncommitted work\n {2}of another session\n\n### Fixed\n\n- Its fix\n\n## \[1\.3\.0\] - 2026-10-24\n\n### Added\n\n- A new command\n\n## \[1\.2\.0\]/
    );
    assert.equal(keepPending(released, changelog, changelog), released);
  });
});
