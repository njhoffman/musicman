const { expect } = require('chai');
const chalk = require('chalk').default;
const { formatDifferences } = require('./differences.cjs');

// eslint-disable-next-line no-control-regex
const stripAnsi = str => str.replace(/\u001b\[[0-9;]*m/g, '');

describe('Differences Output', () => {
  describe('formatDifferences', () => {
    const differences = [
      { value: '{\n  "artist": "Artist 1",\n' },
      { removed: true, value: '  "title": "Title 1"\n' },
      { added: true, value: '  "title": "Title 2"\n' },
      { value: '}' }
    ];

    it('should render indented key/value lines from diff parts', () => {
      const lines = stripAnsi(formatDifferences(differences)).split('\n');
      expect(lines).to.deep.equal([
        '    artist  Artist 1',
        '    title   Title 1 ',
        '    title   Title 2 '
      ]);
    });

    it('should color each line by its diff part', () => {
      const originalLevel = chalk.level;
      chalk.level = 1;
      try {
        const lines = formatDifferences(differences).split('\n');
        expect(lines[1]).to.include(chalk.red('  title'));
        expect(lines[2]).to.include(chalk.green(' Title 2'));
      } finally {
        chalk.level = originalLevel;
      }
    });
  });
});
