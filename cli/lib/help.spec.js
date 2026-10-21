const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('chai');

const { helpOutput } = require('./help.js');
const commands = require('./commands/index.js');
const switchMap = require('./parser/options/switchMap.js');

describe('Help and Version', () => {
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

  it('should answer --version and --help from the cli without a config', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-help-'));
    try {
      const run = args =>
        execFileSync(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
          env: { ...process.env, HOME: home, NODE_ENV: 'test' },
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
