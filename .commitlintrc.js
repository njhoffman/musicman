module.exports = {
  // conventional commits (feat:, fix:, chore(release): ...), what commit-and-tag-version reads
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [1, 'always', 72],
    // subjects can start with a name (Spotify, MPD, ID3)
    'subject-case': [0]
  }
};
