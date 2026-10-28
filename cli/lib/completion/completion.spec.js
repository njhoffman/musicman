const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { expect } = require('chai');
const _ = require('lodash');

const commands = require('../commands/index.js');
const switchMap = require('../parser/options/switchMap.js');
const { formats } = require('../output/formats.js');
const { completionModel } = require('./model.js');
const { renderZsh } = require('./zsh.js');
const { completionCommand, completionOutput, shells } = require('./index.js');

const hasZsh = spawnSync('zsh', ['-fc', 'true']).status === 0;
const model = () => completionModel({ fields: ['artist', 'mood'], shells, completionCommand });

describe('Completion', () => {
  describe('completionModel', () => {
    it('should list every command with its switches and the global ones', () => {
      const { commands: modelCommands } = model();
      expect(_.map(modelCommands, 'name')).to.deep.equal([
        ..._.map(commands, 'name'),
        'completion'
      ]);
      commands.forEach(({ name, switches = [] }) =>
        expect(_.find(modelCommands, { name }).switches).to.have.members([
          ...switches,
          'help',
          'version'
        ])
      );
    });

    it('should give switch values their words, field lists split by commas', () => {
      const { switches } = model();
      expect(switches.format.value).to.deep.equal({ name: 'format', words: formats });
      expect(switches.include.value).to.deep.equal({
        name: 'fields',
        words: ['rating', 'artist', 'mood'],
        separator: ','
      });
      expect(switches.write.value).to.deep.equal({ name: 'name', words: [] });
      expect(switches.recursive).to.not.have.property('value');
      expect(switches.help).to.include({ alias: '-h' });
    });

    it('should take the arguments of view and edit without a command word', () => {
      const { default: noCommand } = model();
      expect(noCommand.switches).to.include.members(['recursive', 'include', 'format', 'files']);
      expect(noCommand.completes).to.deep.equal(['paths', 'filters', 'assignments']);
      expect(noCommand.first).to.deep.equal(['commands']);
    });

    it('should complete the shells after completion and rating once among the fields', () => {
      const { commands: modelCommands, fields } = completionModel({
        fields: ['rating', 'artist'],
        shells,
        completionCommand
      });
      expect(_.find(modelCommands, { name: 'completion' }).words).to.deep.equal(['zsh']);
      expect(fields).to.deep.equal(['rating', 'artist']);
    });
  });

  describe('renderZsh', () => {
    const script = renderZsh(model(), { version: '1.2.3' });

    it('should be a #compdef script that registers itself when sourced', () => {
      expect(script.split('\n')[0]).to.equal('#compdef musicman');
      expect(script).to.include('musicman 1.2.3').and.include('compdef _musicman musicman');
    });

    it('should have a function per command offering its switches and aliases', () => {
      commands.forEach(({ name, switches = [] }) => {
        const body = script.split(`_musicman_cmd_${name}() {`)[1].split('\n}')[0];
        switches.forEach(switchName =>
          expect(body, `${name} --${switchName}`)
            .to.include(`--${switchName}`)
            .and.include(`)${switchMap[switchName].alias}[`)
        );
        expect(body).to.include('--help').and.include('-V[');
      });
      expect(script).to.include(`${_.map(commands, 'name').join('|')}|completion)`);
    });

    it('should complete switch values after = and as the next word', () => {
      expect(script)
        .to.include(`--format=[`)
        .and.include(`:format:(${formats.join(' ')})`);
      expect(script).to.include(':fields:_values -s , fields rating artist mood');
      expect(script).to.include("(--write -w)-w[File name/path of the playlist to write]:name: '");
    });

    it('should complete the kinds of terms each command takes', () => {
      const terms = name => script.split(`_musicman_cmd_${name}() {`)[1].split('\n}')[0];
      expect(terms('view')).to.include("'*: :_musicman_terms paths filters'");
      expect(terms('edit')).to.include("'*: :_musicman_terms paths filters assignments'");
      expect(terms('undo')).to.include("'*: :_musicman_terms word:latest'");
      expect(terms('logs')).to.include("'*: :_musicman_terms commands word:latest'");
      expect(terms('sync')).to.not.include('_musicman_terms');
      expect(script).to.include("local -a fields=('rating' 'artist' 'mood')");
    });

    it('should quote descriptions with quotes and brackets', () => {
      const quirky = completionModel({ fields: ["it's"], shells, completionCommand });
      quirky.switches.fzf.description = "Pick [some] of it's lines";
      const quirkyScript = renderZsh(quirky, { version: '1.2.3' });
      expect(quirkyScript).to.include(`'(--fzf -z)--fzf[Pick \\[some\\] of it'\\''s lines]'`);
      expect(quirkyScript).to.include(`'rating' 'it'\\''s'`);
    });

    (hasZsh ? it : it.skip)('should be valid zsh that sources after compinit', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-completion-'));
      try {
        const file = path.join(dir, '_musicman');
        fs.writeFileSync(file, script);
        execFileSync('zsh', ['-n', file]);
        const registered = execFileSync(
          'zsh',
          [
            '-fc',
            `autoload -U compinit; compinit -u -d ${dir}/zcd; source ${file}; print -r -- $_comps[musicman]`
          ],
          { encoding: 'utf8' }
        );
        expect(registered.trim()).to.equal('_musicman');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('completionOutput', () => {
    it('should return null for other commands without reading fields', () => {
      const fields = () => {
        throw new Error('read fields');
      };
      expect(completionOutput(['view', '-r'], { version: '1.2.3', fields })).to.be.null;
      expect(completionOutput([], { version: '1.2.3', fields })).to.be.null;
    });

    it('should render the script for a known shell', () => {
      const script = completionOutput(['completion', 'zsh'], {
        version: '1.2.3',
        fields: () => ['grouping']
      });
      expect(script).to.include('#compdef musicman').and.include("'grouping'");
    });

    it('should throw for a missing or unknown shell', () => {
      const options = { version: '1.2.3', fields: () => [] };
      expect(() => completionOutput(['completion'], options)).to.throw(
        'musicman completion takes a shell: zsh'
      );
      expect(() => completionOutput(['completion', 'fish'], options)).to.throw('takes a shell');
    });

    it('should print the script from the cli with the config fields and without creating a config', () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-completion-'));
      try {
        const run = args =>
          spawnSync(process.execPath, [path.join(__dirname, '..', 'cli.js'), ...args], {
            env: { ...process.env, HOME: home, NODE_ENV: 'test' },
            encoding: 'utf8'
          });
        const { stdout, status } = run(['completion', 'zsh']);
        expect(status).to.equal(0);
        expect(stdout).to.include('#compdef musicman').and.include("'album_artist'");
        expect(stdout).to.include("'sp_track_id'");
        expect(fs.existsSync(path.join(home, '.musicmanrc.yml'))).to.be.false;
        const unknown = run(['completion', 'tcsh']);
        expect(unknown.status).to.equal(1);
        expect(unknown.stdout).to.equal('');
        expect(run(['completion', '--help']).stdout).to.include('Usage: musicman completion <zsh>');
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });
});
