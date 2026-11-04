const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('chai');
const chalk = require('chalk').default;

const { stripAnsi } = require('./utils/logger.js');
const { helpOutput } = require('./help.js');
const commands = require('./commands/index.js');
const switchMap = require('./parser/options/switchMap.js');

describe('Help and Version', () => {
  let originalLevel;

  beforeEach(() => {
    originalLevel = chalk.level;
    chalk.level = 0;
  });

  afterEach(() => {
    chalk.level = originalLevel;
  });

  it('should print the version for --version or -V', () => {
    expect(helpOutput(['--version'], '1.2.3')).to.equal('1.2.3');
    expect(helpOutput(['view', '-V'], '1.2.3')).to.equal('1.2.3');
  });

  it('should return null when neither is asked for', () => {
    expect(helpOutput(['view', 'rating:4'], '1.2.3')).to.be.null;
  });

  it('should list every command and switch in the general help', () => {
    const help = helpOutput(['--help'], '1.2.3');
    expect(help).to.include('musicman 1.2.3');
    commands.forEach(({ name, description }) =>
      expect(help).to.include(`${name}`).and.include(description)
    );
    Object.entries(switchMap).forEach(([name, { alias, value }]) =>
      expect(help).to.include(
        value ? `--${name}=<${value}>, ${alias} <${value}>` : `--${name}, ${alias}`
      )
    );
    expect(help).to.include('--help, -h').and.include('--version, -V');
  });

  it('should show one command with only its switches', () => {
    const help = helpOutput(['db', '-h'], '1.2.3');
    expect(help).to.include('musicman db: Show library database stats');
    expect(help).to.include('--update, -u').and.include('--backup, -b');
    expect(help).to.not.include('--push');
  });

  it('should describe every command and name only known switches', () => {
    commands.forEach(command => {
      expect(command.description, command.name).to.be.a('string');
      expect(command.usage, command.name).to.be.a('string');
      (command.switches || []).forEach(name =>
        expect(switchMap, `${command.name} ${name}`).to.have.property(name)
      );
    });
  });

  it('should color the help and keep the columns aligned', () => {
    chalk.level = 3;
    const colored = helpOutput(['--help'], '1.2.3');
    const db = helpOutput(['db', '-h'], '1.2.3');
    chalk.level = 0;
    expect(stripAnsi(colored)).to.equal(helpOutput(['--help'], '1.2.3'));
    expect(stripAnsi(db)).to.equal(helpOutput(['db', '-h'], '1.2.3'));
    [
      'Usage:',
      'Switches:',
      'view',
      '--format=',
      '<format>',
      'field:value',
      'musicman 1.2.3'
    ].forEach(text => expect(colored).to.include(`${text}\u001b[`));
    expect(db).to.include('Usage:\u001b[');
  });

  it('should leave the help without color codes when color is off', () => {
    expect(helpOutput(['--help'], '1.2.3')).to.not.include('\u001b[');
  });

  it('should describe a shared switch for the command showing it', () => {
    const analyze = helpOutput(['analyze', '--help'], '1.2.3');
    expect(analyze).to.include('Analyse every song again');
    expect(analyze).to.not.include('--match');
    expect(helpOutput(['undo', '--help'], '1.2.3')).to.include(
      'Also restore files changed since the run'
    );
    // the general help keeps the wording that covers them all
    expect(helpOutput(['--help'], '1.2.3')).to.include('analyze: analyse every song again');
  });

  it('should only reword switches a command has, and not point at other commands', () => {
    commands.forEach(command => {
      Object.keys(command.switchHelp || {}).forEach(name =>
        expect(command.switches, `${command.name} ${name}`).to.include(name)
      );
      const others = commands.filter(({ name }) => name !== command.name).map(({ name }) => name);
      const elsewhere = new RegExp(`\\b(With (${others.join('|')}),|(${others.join('|')})( --|:))`);
      (command.switches || []).forEach(name => {
        const text = (command.switchHelp || {})[name] || switchMap[name].description;
        expect(text, `${command.name} --${name}`).to.not.match(elsewhere);
      });
    });
  });

  describe('wrapping', () => {
    const width = 80;
    const row = (lines, name) => lines.find(line => line.startsWith(`  --${name},`));

    it('should fit the terminal and wrap descriptions to their column', () => {
      ['--help', 'db --help', 'sync --help', 'check --help'].forEach(given => {
        const lines = helpOutput(given.split(' '), '1.2.3', { width }).split('\n');
        lines.forEach(line => expect(line.length, line).to.be.at.most(width));
      });
      const lines = helpOutput(['db', '--help'], '1.2.3', { width }).split('\n');
      const first = row(lines, 'readmit');
      const column = first.indexOf('With db');
      const next = lines[lines.indexOf(first) + 1];
      expect(next.slice(0, column).trim()).to.equal('');
      expect(next[column]).to.not.equal(' ');
    });

    it('should lose no words when wrapping', () => {
      const words = text => text.split(/\s+/).join(' ');
      expect(words(helpOutput(['--help'], '1.2.3', { width }))).to.equal(
        words(helpOutput(['--help'], '1.2.3'))
      );
    });

    it('should break a long list at its commas and keep every value', () => {
      const squeezed = text => text.replace(/\s+/g, '');
      const wrapped = helpOutput(['check', '--help'], '1.2.3', { width });
      expect(squeezed(wrapped)).to.equal(squeezed(helpOutput(['check', '--help'], '1.2.3')));
      expect(wrapped.split('\n').some(line => line.endsWith(','))).to.be.true;
    });

    it('should keep the colors right on wrapped lines', () => {
      chalk.level = 3;
      const colored = helpOutput(['sync', '--help'], '1.2.3', { width });
      chalk.level = 0;
      expect(stripAnsi(colored)).to.equal(helpOutput(['sync', '--help'], '1.2.3', { width }));
    });

    it('should leave entries on one line without a width or in a very narrow terminal', () => {
      const unwrapped = helpOutput(['db', '--help'], '1.2.3');
      expect(row(unwrapped.split('\n'), 'readmit')).to.include('from a directory');
      const narrow = helpOutput(['db', '--help'], '1.2.3', { width: 30 }).split('\n');
      expect(row(narrow, 'readmit')).to.include('from a directory');
    });
  });

  it('should answer --version and --help from the cli without a config', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-help-'));
    try {
      const run = args =>
        execFileSync(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
          env: { ...process.env, HOME: home, NODE_ENV: 'test', FORCE_COLOR: '0' },
          encoding: 'utf8'
        });
      const { version } = require('../../package.json');
      expect(run(['--version']).trim()).to.equal(version);
      expect(run(['--help'])).to.include('Usage: musicman');
      expect(fs.existsSync(path.join(home, '.musicmanrc.yml'))).to.be.false;
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
